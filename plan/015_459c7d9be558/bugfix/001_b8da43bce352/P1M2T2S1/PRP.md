# PRP — P1.M2.T2.S1: Update gitAdd assertion to pathspec + mock git plumbing so smartCommit completes

> Bugfix 001, **BUG-002 (Minor) §(b)** — restore the 1 failing `protected-files.test.ts` test.
> `smartCommit` was reworked to PRD §5.1 ARG_MAX-safe **pathspec** staging (`gitAdd({path})`, no `files`
> key) + a snapshot **plumbing** commit (`gitWriteTree` → `gitCommitTree` → `gitUpdateRefCAS`), but
> `tests/unit/protected-files.test.ts` still mocks only `{gitStatus, gitAdd,gitCommit}` and asserts the
> old per-file `gitAdd({path, files:[...]})`. The plumbing symbols are `undefined` under the factory mock
> → smartCommit throws a TypeError inside its outer try/catch → returns `null` → the test fails on BOTH
> the `gitAdd` assertion AND `expect(result).toBe('abc123')`. **This item is test-only** (no `src/`
> change): add the plumbing mocks to the factory + fix the assertion so smartCommit completes through
> the full plumbing path and returns `'abc123'`. Architecture pin: `bug002_stale_tests.md §(b)`.

---

## Goal

**Feature Goal**: Make `tests/unit/protected-files.test.ts:709` ("should filter all protected files in smart commit workflow") **PASS** by (a) adding the git-plumbing mocks the §5.1-reworked `smartCommit` now calls to the `vi.mock('../../src/tools/git-mcp.js', …)` factory (with success defaults), (b) fixing the `gitAdd` assertion to the pathspec form `{ path: '/project' }` (no `files` key), and (c) keeping `expect(result).toBe('abc123')` — where `'abc123'` now comes from `gitCommitTree`'s `commitSha` (not porcelain `gitCommit`). No `src/` changes.

**Deliverable**:
1. **`tests/unit/protected-files.test.ts`** — EDIT (test-only): (a) extend the mock factory (lines 23-26) with the 8 plumbing/helper symbols smartCommit + restore_critical_files call, each with a success-default `.mockResolvedValue(...)`; (b) extend the named import (line 55) + add `vi.mocked` spy handles for the 5 core plumbing symbols; (c) fix the `@709` gitAdd assertion (line 738) to `{ path: '/project' }`; (d) add plumbing-path assertions (`mockGitCommitTree`/`mockGitUpdateRefCAS` called; `mockGitCommit` NOT called) that both lock the §5.1 path and consume the new handles.

**Success Definition**:
- `npx vitest run tests/unit/protected-files.test.ts` is GREEN (the `@709` test passes; `@746` stays green — it early-returns before any plumbing).
- `mockGitAdd` is asserted as `toHaveBeenCalledWith({ path: '/project' })` (pathspec, no `files`).
- `result === 'abc123'` (from `gitCommitTree`'s `commitSha` via the factory default).
- `mockGitCommitTree` + `mockGitUpdateRefCAS` are asserted called; `mockGitCommit` asserted NOT called (porcelain gone).
- No `src/` file is modified; no other test file is touched (file-disjoint from the parallel P1.M2.T1.S1).

---

## Why

- **BUG-002 §(b): a stale test after a legitimate §5.1 change.** smartCommit's ARG_MAX-safe pathspec staging + snapshot plumbing commit (P1.M1.T2/T3) is the PRD-compliant behavior — the implementation is correct. The test was never updated, so it encodes the OLD per-file `gitAdd({path, files:[...]})` + porcelain `gitCommit` model and fails. This item realigns the test with the shipped behavior.
- **Unblocks the green-suite gate.** A permanently-red suite hides real regressions and breaks the project's own `npm run validate` / CI gate. P1.M2.T4.S1 verifies the full suite reaches 0 failures; this item contributes the `protected-files.test.ts` 1-failure → 0.
- **The plumbing mocks are required, not cosmetic.** Under the current 3-symbol factory, every plumbing import in `git-commit.ts` (`gitUnstagePath`, `gitRevParseHead`, `gitWriteTree`, `gitCommitTree`, `gitUpdateRefCAS`, `gitListStagedDeletions`, `gitRestoreFileFromHead`, `gitDiff`) resolves to `undefined` → smartCommit throws → returns `null` → `result === null`, not `'abc123'`. Adding the mocks is the only way smartCommit completes through the plumbing path in this unit test.
- **`clearAllMocks` preserves implementations — factory defaults survive.** The file's `beforeEach` uses `vi.clearAllMocks()` (NOT `resetAllMocks()`), so the factory's `.mockResolvedValue(...)` plumbing defaults persist across tests without per-test setup. (The load-bearing fact — see research §1.)
- **Test-only + scoped.** This item edits ONLY `tests/unit/protected-files.test.ts`. It does NOT touch `src/utils/git-commit.ts`, `src/tools/git-mcp.ts`, or any other test file. It is file-disjoint from the parallel P1.M2.T1.S1 (`fix-cycle-workflow.test.ts`).
- **Out of scope (hard boundary):** the fix-cycle-workflow tests (P1.M2.T1.S1 — parallel), the prp-executor-integration format-nudge text (P1.M2.T3.S1), the full-suite verification + docs sweep (P1.M2.T4.S1), any `src/` change, BUG-001 (already Complete), any `docs/*.md` (Mode A — none), `PRD.md`, `tasks.json`.

---

## What

### User-visible behavior
None — test-only. The shipped smartCommit behavior is unchanged; this item only makes the unit test assert what smartCommit actually does (pathspec staging + plumbing commit).

### Technical requirements (exact contract)

**`tests/unit/protected-files.test.ts` mock factory** (lines 23-26) — extend with the 8 plumbing/helper symbols smartCommit + restore_critical_files call, each with a success default (so smartCommit completes; the defaults survive `clearAllMocks` — see Why):
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
(The 3 restore-critical-files helpers — `gitDiff`, `gitListStagedDeletions`, `gitRestoreFileFromHead` — are exported so they aren't `undefined` inside `restore_critical_files` (which swallows its own errors); returning `{success:true}` is safe. `gitDiff` is NOT reached by the `@709` plain-message path but is exported to avoid noise.)

**`tests/unit/protected-files.test.ts` named import** (line 55) — add the 5 core plumbing symbols (the ones smartCommit directly calls + the test asserts on):
```ts
import {
  gitStatus,
  gitAdd,
  gitCommit,
  gitUnstagePath,
  gitRevParseHead,
  gitWriteTree,
  gitCommitTree,
  gitUpdateRefCAS,
} from '../../src/tools/git-mcp.js';
```

**Spy handles** (after line 63, alongside `mockGitStatus`/`mockGitAdd`/`mockGitCommit`):
```ts
const mockGitUnstagePath = vi.mocked(gitUnstagePath);
const mockGitRevParseHead = vi.mocked(gitRevParseHead);
const mockGitWriteTree = vi.mocked(gitWriteTree);
const mockGitCommitTree = vi.mocked(gitCommitTree);
const mockGitUpdateRefCAS = vi.mocked(gitUpdateRefCAS);
```

**The `@709` test assertions** (lines ~738-745) — FIX the gitAdd assertion, KEEP the result assertion, ADD plumbing-path assertions (which also consume the new handles → no unused-var):
```diff
       // VERIFY - only non-protected files should be staged
       // tasks.json is intentionally NOT protected (rides with commit for status delta)
-      expect(mockGitAdd).toHaveBeenCalledWith({
-        path: '/project',
-        files: ['src/index.ts', 'tasks.json', 'src/utils.ts'],
-      });
+      // §5.1 ARG_MAX-safe pathspec staging: gitAdd({path}) with NO files key (→ git add .).
+      // Protected files are unstaged AFTER staging (gitUnstagePath), not excluded from the add.
+      expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });
+      // §5.1 snapshot plumbing commit: commit-tree → CAS update-ref (porcelain gitCommit is GONE).
+      expect(mockGitCommitTree).toHaveBeenCalledWith(
+        expect.objectContaining({ treeSha: 'tree-sha', repoPath: '/project' })
+      );
+      expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
+        repoPath: '/project',
+        newSha: 'abc123',
+        expectedOldSha: 'parent-sha',
+      });
+      expect(mockGitCommit).not.toHaveBeenCalled();
       expect(result).toBe('abc123');
```
(The `mockGitStatus`/`mockGitAdd` SETUP blocks at @711/@724 STAY. The `mockGitCommit.mockResolvedValue({success:true, commitHash:'abc123'})` at @728 is now stale — `gitCommit` is never called — but HARMLESS; leave it to minimize churn, or remove for cleanliness. Either is fine.)

### Success Criteria
- [ ] `npx vitest run tests/unit/protected-files.test.ts` GREEN (`@709` passes; `@746` stays green).
- [ ] `mockGitAdd` asserted as `toHaveBeenCalledWith({ path: '/project' })` (pathspec, no `files`).
- [ ] `result === 'abc123'` (from `gitCommitTree`'s `commitSha`).
- [ ] `mockGitCommitTree` + `mockGitUpdateRefCAS` asserted called; `mockGitCommit` asserted NOT called.
- [ ] Factory exports all 8 plumbing/helper symbols with success defaults; 5 core plumbing handles created.
- [ ] NO `src/` file modified; NO other test file touched.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the verbatim factory extension + import + handles + assertion diff; the **load-bearing fact** that `beforeEach` uses `vi.clearAllMocks()` (NOT `resetAllMocks()`) so factory `.mockResolvedValue` defaults survive; the verified return shapes for every plumbing symbol (from `git-mcp.ts`); the exact smartCommit path for the plain-message call (`smartCommit('/project','Test commit')` → no `generateMessage` → no gitDiff/stagecoach); the reason `'abc123'` now flows from `gitCommitTree.commitSha`; the proof that `@746` stays green (early-return before gitAdd); and the file-disjointness from the parallel P1.M2.T1.S1. See `research/protected-files-mock-map.md` for the per-claim evidence.

### Documentation & References
```yaml
# AUTHORITATIVE SPEC — the stale-test fix design
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/architecture/bug002_stale_tests.md
  section: "(b) protected-files.test.ts — 1 failure (§5.1 pathspec staging + plumbing)"
  why: Pins the pathspec gitAdd({path}) form, the full plumbing call list (gitUnstagePath/gitRevParseHead/
        gitWriteTree/gitCommitTree/gitUpdateRefCAS + restore_critical_files helpers), and the 3-step fix
        (assertion → factory mocks → keep result='abc123' from commitTree).
  critical: smartCommit uses PLUMBING, not porcelain gitCommit; the factory must export ALL plumbing symbols
        or they're undefined → TypeError → smartCommit returns null.

# THIS SUBTASK'S RESEARCH — the verified mock map + the clearAllMocks fact
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T2S1/research/protected-files-mock-map.md
  section: "1. clearAllMocks preserves implementations", "2. smartCommit path for @709",
           "3. verified return shapes", "4. factory additions", "6. assertion changes", "7. @746 stays green"
  why: THE load-bearing fact (clearAllMocks ≠ resetAllMocks → factory defaults survive); the exact plumbing
        path; the verified git-mcp return shapes; why 'abc123' comes from gitCommitTree; @746's early-return.

# THE FILE TO EDIT
- file: tests/unit/protected-files.test.ts
  why: EDIT (test-only). Factory@23-26 (only gitStatus/gitAdd/gitCommit); import@55; handles@61-63;
        @709 test (gitAdd assertion@738, result@745); @746 test (early-return, unaffected). beforeEach@221
        uses vi.clearAllMocks() (NOT resetAllMocks) → factory defaults persist.
  pattern: "vi.mock('../../src/tools/git-mcp.js', () => ({ gitStatus: vi.fn(), gitAdd: vi.fn(), gitCommit: vi.fn() }));"
  gotcha: clearAllMocks preserves mockResolvedValue implementations — so factory-default plumbing mocks
        survive without per-test setup. Do NOT switch to resetAllMocks (would wipe the defaults).

# THE BEHAVIOR UNDER TEST (read-only — DO NOT EDIT)
- file: src/utils/git-commit.ts
  why: smartCommit's §5.1 path: gitAdd({path:repoRoot})@~826 (NO files key → pathspec); gitUnstagePath@~838
        loop; restore_critical_files@~852; gitRevParseHead@~855; gitWriteTree@~857; (plain-message branch:
        formatCommitMessage(message, position)); gitCommitTree@~962 → newSha=commitSha; gitUpdateRefCAS@~976;
        returns newSha. Imports ALL plumbing symbols@26-33. smartCommit('/project','Test commit') has NO
        options → generateMessage falsy → plain-message branch (NO gitDiff/stagecoach). READ-ONLY.
- file: src/tools/git-mcp.ts
  why: READ-ONLY — the verified return shapes: gitWriteTree→{success,treeSha}; gitRevParseHead→{success,sha};
        gitCommitTree→{success,commitSha} (input {treeSha,message,parentSha?,repoPath?}); gitUpdateRefCAS→
        {success} (input {repoPath,newSha,expectedOldSha}); gitUnstagePath→{success} (positional file,repoRoot);
        gitListStagedDeletions→{success,files}; gitRestoreFileFromHead→{success}; gitDiff→{success,diff}.

# PARALLEL-SIBLING (no overlap — different test file)
- docfile: plan/015_459c7d9be558/bugfix/001_b8da43bce352/P1M2T1S1/PRP.md
  why: P1.M2.T1.S1 edits tests/unit/workflows/fix-cycle-workflow.test.ts (context_scope fixtures). This item
        edits tests/unit/protected-files.test.ts. DIFFERENT files → zero overlap, no merge conflict.
```

### Current Codebase tree (relevant slice)
```bash
tests/unit/protected-files.test.ts        # EDIT (test-only): factory + import + handles + @709 assertions
src/utils/git-commit.ts                   # READ-ONLY (smartCommit §5.1 plumbing path — the behavior under test)
src/tools/git-mcp.ts                      # READ-ONLY (plumbing return shapes)
```

### Desired Codebase tree with files to be added/edited
```bash
tests/unit/protected-files.test.ts        # MODIFIED (factory extension + import + handles + @709 assertion fix)
# No src/ changes. No other test file. No docs/*.md (Mode A — none).
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — beforeEach uses vi.clearAllMocks() (protected-files.test.ts:223), NOT resetAllMocks().
//   clearAllMocks clears mock.calls/results but PRESERVES the implementation set via mockResolvedValue.
//   ⇒ factory-default .mockResolvedValue(...) plumbing mocks SURVIVE across tests without per-test setup.
//   Do NOT "fix" this to resetAllMocks — that would wipe the factory defaults after test 1 and break @709
//   if it isn't first. (This is THE load-bearing fact — see research §1.)

// CRITICAL — gitAdd is now PATHSPEC: smartCommit calls gitAdd({ path: repoRoot }) with NO files key
//   (git-commit.ts:~826, §5.1 ARG_MAX-safe staging → git add .). The OLD assertion ({path, files:[...]}) is
//   stale. Fix to expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' }). Protected files are
//   unstaged AFTER staging (gitUnstagePath loop), NOT excluded from the add.

// CRITICAL — smartCommit uses PLUMBING, not porcelain gitCommit. The factory MUST export gitUnstagePath,
//   gitRevParseHead, gitWriteTree, gitCommitTree, gitUpdateRefCAS (direct smartCommit calls) AND gitDiff,
//   gitListStagedDeletions, gitRestoreFileFromHead (restore_critical_files internals). git-commit.ts:26-33
//   imports ALL of them; under the current 3-symbol factory they're undefined → TypeError → smartCommit
//   returns null. Exporting them with success defaults is REQUIRED for smartCommit to complete.

// CRITICAL — 'abc123' now comes from gitCommitTree's commitSha, NOT gitCommit. smartCommit returns
//   newSha = commitTreeResult.commitSha (git-commit.ts:~965). Mock gitCommitTree → {success:true, commitSha:'abc123'}
//   so result === 'abc123'. (gitCommit is never called — assert mockGitCommit NOT called.)

// GOTCHA — smartCommit('/project', 'Test commit') has NO options → generateMessage is falsy → the
//   plain-message branch (formatCommitMessage(message, position)). So gitDiff / stagecoach generation is
//   NOT exercised by @709. You do NOT need to mock the stagecoach/generate path for THIS test (gitDiff is
//   exported only to avoid undefined noise; it isn't called here).

// GOTCHA — @746 ("only protected files changed") stays GREEN unchanged: mockGitStatus returns all-protected
//   → filterProtectedFiles → [] → smartCommit returns null at `if (filteredFiles.length === 0) return null`
//   BEFORE gitAdd. No plumbing reached; the factory plumbing defaults are harmless. Do NOT edit @746.

// GOTCHA — Return shapes are NOT all identical — match each to git-mcp.ts: gitWriteTree→{success,treeSha};
//   gitRevParseHead→{success,sha}; gitCommitTree→{success,commitSha}; gitUpdateRefCAS→{success};
//   gitUnstagePath→{success}; gitListStagedDeletions→{success,files}. A wrong shape (e.g. gitWriteTree
//   returning {success,sha}) makes smartCommit read `undefined` → crash → null → @709 fails on result.

// GOTCHA — Create spy handles (vi.mocked) for the 5 core plumbing symbols you import, AND add assertions
//   that use them (mockGitCommitTree/mockGitUpdateRefCAS called; mockGitCommit NOT called). This both locks
//   the §5.1 plumbing path AND avoids an unused-var lint flag on the handles. (The 3 restore-critical-files
//   helpers are factory-only — NOT imported/handled — since @709 doesn't assert on them.)

// GOTCHA — mockGitCommit.mockResolvedValue({success:true, commitHash:'abc123'}) (@728) is now STALE
//   (gitCommit never called). It's HARMLESS — leave it (minimize churn) or remove (cleaner). Do NOT delete
//   the mockGitCommit handle/import — @709 asserts `mockGitCommit not called` + @746 asserts the same.

// GOTCHA — Do NOT run the full `npm run test:run` as THIS item's gate (other stale tests — fix-cycle §(a),
//   prp-executor §(c) — are sibling subtasks P1.M2.T1/P1.M2.T3, not yet fixed). Gate = the targeted
//   tests/unit/protected-files.test.ts (GREEN). The full-suite-green gate is P1.M2.T4.S1.

// CRITICAL — Test-only: DO NOT edit src/utils/git-commit.ts, src/tools/git-mcp.ts, or any other test file.
//   The §5.1 plumbing path is the PRD-compliant behavior; this item only updates the test to match it.
```

---

## Implementation Blueprint

### Data models and structure
No data models. Three additive mockfactory entries + 5 import additions + 5 spy handles + 1 assertion fix + 3 strengthening assertions. All confined to `tests/unit/protected-files.test.ts`.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT tests/unit/protected-files.test.ts  (the factory + import + handles + @709 assertions)
  - FACTORY (lines 23-26): add the 8 plumbing/helper symbols with success defaults (verbatim in "Technical
        requirements"). Keep gitStatus/gitAdd/gitCommit as bare vi.fn() (per-test setup stays).
  - IMPORT (line 55): add gitUnstagePath, gitRevParseHead, gitWriteTree, gitCommitTree, gitUpdateRefCAS.
  - HANDLES (after line 63): add mockGitUnstagePath/mockGitRevParseHead/mockGitWriteTree/mockGitCommitTree/
        mockGitUpdateRefCAS via vi.mocked(...).
  - @709 ASSERTIONS (lines ~738-745): apply the verbatim diff in "Technical requirements" — fix gitAdd to
        {path:'/project'}; add mockGitCommitTree/mockGitUpdateRefCAS called + mockGitCommit NOT called;
        KEEP expect(result).toBe('abc123').
  - DO NOT: edit @746; touch src/; switch clearAllMocks→resetAllMocks; remove the mockGitCommit handle/import;
        change any other test in the file.
  - EXPECTED: @709 now PASSES (smartCommit completes via the factory-default plumbing → returns 'abc123');
        @746 stays GREEN (early-return before gitAdd).

Task 2: VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/protected-files.test.ts   # @709 + @746 + all other protected-files tests — GREEN.
  - RUN: git diff --name-only → ONLY tests/unit/protected-files.test.ts.
  - DO NOT run the full `npm run test:run` as this item's gate (sibling stale tests §a/§c are P1.M2.T1/T3).
        The full-suite-green gate is P1.M2.T4.S1.
  - EXPECTED: targeted suite green; only the 1 test file changed. If @709 fails on `result`, a plumbing mock
        has the wrong return shape (recheck gitWriteTree→treeSha / gitCommitTree→commitSha / gitRevParseHead→sha).
        If @709 fails on the gitAdd assertion, the call still carries a files key (recheck you didn't regressed
        the factory). If @746 regressed, you accidentally made the early-return path reach plumbing — revert.
```

### Implementation Patterns & Key Details
```ts
// ---- the factory extension (defaults survive clearAllMocks — see research §1) ----
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

// ---- the @709 assertions (pathspec + plumbing path locked) ----
expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' });            // §5.1 pathspec (NO files key)
expect(mockGitCommitTree).toHaveBeenCalledWith(
  expect.objectContaining({ treeSha: 'tree-sha', repoPath: '/project' })
);
expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({
  repoPath: '/project', newSha: 'abc123', expectedOldSha: 'parent-sha',
});
expect(mockGitCommit).not.toHaveBeenCalled();                              // porcelain gitCommit is GONE
expect(result).toBe('abc123');                                             // from gitCommitTree.commitSha
```

### Integration Points
```yaml
PROTECTED-FILES.TEST.TS:
  - factory: +8 plumbing/helper symbols with success defaults (clearAllMocks preserves them).
  - import: +5 core plumbing symbols; handles: +5 vi.mocked spies.
  - @709: gitAdd assertion → {path:'/project'}; +plumbing-path assertions; KEEP result==='abc123'.
  - PRESERVE: @746 (early-return, unaffected), the mockGitStatus/mockGitAdd SETUP blocks, the mockGitCommit
    handle/import (@709 + @746 assert `not called`), beforeEach's clearAllMocks.

NO SRC/ CHANGES:
  - src/utils/git-commit.ts (smartCommit §5.1 plumbing — the behavior under test) — UNCHANGED.
  - src/tools/git-mcp.ts (plumbing return shapes) — UNCHANGED.

DOWNSTREAM CONSUMER (P1.M2.T4.S1 — NOT this item):
  - full-suite verification: this item's GREEN protected-files.test.ts contributes to the 0-failures gate.

DOCS (Mode A — none):
  - Test-only change; no user-facing/config/API surface. No docs/*.md.
  - Commit message notes: BUG-002 §(b); smartCommit §5.1 pathspec + plumbing; factory plumbing mocks;
        clearAllMocks-preserves-implementations; 'abc123' now from gitCommitTree; test-only (no src/).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean (the new imports + handles typecheck)
npm run lint           # eslint . --ext .ts — clean (the new handles are USED by the new assertions → no unused-var)
npm run format:check   # prettier --check — clean
# Expected: all clean. If lint flags an unused handle, you forgot its assertion (add the plumbing-path assert).
```

### Level 2: Unit Tests (the gate)
```bash
# The directly-affected suite — @709 passes + @746 stays green + all other protected-files tests:
npx vitest run tests/unit/protected-files.test.ts
# Expected: GREEN. If @709 fails on `result` (got null) → a plumbing mock has the wrong shape (recheck
#   gitWriteTree→{success,treeSha} / gitCommitTree→{success,commitSha} / gitRevParseHead→{success,sha}).
#   If @709 fails on the gitAdd assertion → smartCommit still passed a files key (impossible if src/ is
#   unchanged — recheck you didn't accidentally edit git-commit.ts). If @746 regressed → revert any change
#   to the early-return path / the factory (the defaults must not make @746 reach gitAdd).
# Do NOT run the full `npm run test:run` as THIS item's gate (sibling stale tests §a/§c are other subtasks).
```

### Level 3: Regression (System Validation)
```bash
# Confirm ONLY the 1 test file changed (no src/, no other test file):
git diff --name-only   # Expect ONLY tests/unit/protected-files.test.ts.
# Confirm the factory exports the plumbing + the assertion is the pathspec form:
grep -n "gitCommitTree\|gitUpdateRefCAS\|gitWriteTree" tests/unit/protected-files.test.ts  # factory + handles + asserts
grep -n "toHaveBeenCalledWith({ path: '/project' })" tests/unit/protected-files.test.ts   # the pathspec assertion
grep -n "files: \['src/index.ts'" tests/unit/protected-files.test.ts                      # Expect ZERO (old assertion gone)
# Expected: git diff shows only the test file; the old per-file gitAdd assertion is gone; the plumbing
# factory entries + handles + assertions are present.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (pure unit test with vi.fn mocks). Domain checks (record in commit message):
#   1. smartCommit now stages via pathspec (gitAdd({path})) + commits via plumbing (write-tree → commit-tree
#      → CAS update-ref), per §5.1 ARG_MAX-safe staging. The test asserts that path.
#   2. 'abc123' flows from gitCommitTree.commitSha (smartCommit returns newSha), NOT porcelain gitCommit.
#   3. Porcelain gitCommit is no longer called by smartCommit (asserted mockGitCommit NOT called).
#   4. @746 (all-protected → nothing to stage) still returns null early — the plumbing mocks are harmless.
#   5. clearAllMocks (not resetAllMocks) is why the factory defaults survive — do not "fix" it.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/protected-files.test.ts` GREEN (@709 passes; @746 + all others green).
- [ ] `git diff --name-only` = ONLY `tests/unit/protected-files.test.ts`.

### Feature Validation
- [ ] Factory exports all 8 plumbing/helper symbols with success defaults.
- [ ] 5 core plumbing symbols imported + 5 spy handles created.
- [ ] `mockGitAdd` asserted `toHaveBeenCalledWith({ path: '/project' })` (pathspec, no `files`).
- [ ] `result === 'abc123'` (from `gitCommitTree.commitSha`).
- [ ] `mockGitCommitTree`/`mockGitUpdateRefCAS` asserted called; `mockGitCommit` asserted NOT called.
- [ ] @746 unchanged + green.

### Code Quality Validation
- [ ] Factory plumbing defaults use the VERIFIED return shapes (treeSha/sha/commitSha — not all `{success}`).
- [ ] New handles are USED by assertions (no unused-var lint).
- [ ] clearAllMocks NOT switched to resetAllMocks (factory defaults must survive).
- [ ] No `src/` change; no other test file touched.

### Documentation & Deployment
- [ ] No `docs/*.md` (Mode A — none; test-only).
- [ ] Commit message notes: BUG-002 §(b); smartCommit §5.1 pathspec + plumbing; factory plumbing mocks;
      clearAllMocks-preserves-implementations; 'abc123' from gitCommitTree; test-only; @746 unaffected.

---

## Anti-Patterns to Avoid

- ❌ Don't switch `beforeEach`'s `vi.clearAllMocks()` to `vi.resetAllMocks()`. `clearAllMocks` PRESERVES
      `.mockResolvedValue` implementations (so factory plumbing defaults survive across tests); `resetAllMocks`
      would wipe them after test 1. The factory-default approach DEPENDS on `clearAllMocks`.
- ❌ Don't keep the old per-file `gitAdd({path, files:['src/index.ts','tasks.json','src/utils.ts']})` assertion.
      smartCommit now stages via pathspec `gitAdd({path})` (no `files` key, §5.1). Fix it to `{path:'/project'}`.
- ❌ Don't give all plumbing mocks the same `{success:true}` shape. They differ (verified in git-mcp.ts):
      `gitWriteTree`→`{success,treeSha}`, `gitRevParseHead`→`{success,sha}`, `gitCommitTree`→`{success,commitSha}`,
      `gitUpdateRefCAS`→`{success}`, `gitUnstagePath`→`{success}`. A wrong shape → smartCommit reads `undefined`
      → crash → `result===null` → @709 fails.
- ❌ Don't expect `'abc123'` from porcelain `gitCommit`. smartCommit returns `newSha = commitTreeResult.commitSha`;
      mock `gitCommitTree`→`{success:true, commitSha:'abc123'}`. (`gitCommit` is never called — assert NOT called.)
- ❌ Don't edit `@746`. It early-returns (`filteredFiles.length===0` → null) BEFORE gitAdd, so no plumbing is
      reached and the factory defaults are harmless. Its assertions (`result===null`, gitAdd/gitCommit not called)
      still hold.
- ❌ Don't omit the 3 restore-critical-files helpers (`gitDiff`, `gitListStagedDeletions`, `gitRestoreFileFromHead`)
      from the factory. `restore_critical_files` (called by smartCommit) imports them; under a 3-symbol factory
      they're `undefined` → noise/errors inside restore_critical_files (it swallows errors, but exporting them
      with `{success:true}` is the clean fix the contract prescribes).
- ❌ Don't create unused spy handles. Import + handle the 5 CORE plumbing symbols AND add assertions that use
      them (mockGitCommitTree/mockGitUpdateRefCAS called; mockGitCommit NOT called). The 3 helpers are
      factory-only (not imported/handled).
- ❌ Don't touch `src/utils/git-commit.ts` or `src/tools/git-mcp.ts` — the §5.1 plumbing path is the PRD-compliant
      behavior; this item is TEST-ONLY. Don't touch any other test file (file-disjoint from P1.M2.T1.S1).
- ❌ Don't run the full `npm run test:run` as THIS item's gate — sibling stale tests (fix-cycle §a, prp-executor §c)
      are P1.M2.T1.S1/P1.M2.T3.S1. Gate on the targeted `tests/unit/protected-files.test.ts`; full-suite-green is P1.M2.T4.S1.
- ❌ Don't delete the `mockGitCommit` handle/import or its `@728` setup — @709 asserts `mockGitCommit not called`
      and @746 asserts the same. The `@728` setup is stale but harmless; leave it (or remove for cleanliness).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, test-only change. Every edit is pinned verbatim (the factory
extension with the 8 symbols + their verified return shapes, the import/handle additions, and the assertion
diff). The single load-bearing fact — `beforeEach` uses `vi.clearAllMocks()` (NOT `resetAllMocks()`), so the
factory `.mockResolvedValue` defaults survive across tests — is verified and documented, which is why the
factory-default approach works without per-test plumbing setup. The smartCommit plumbing path for the
plain-message `@709` call is traced step-by-step (gitAdd → gitUnstagePath → restore_critical_files →
gitRevParseHead → gitWriteTree → gitCommitTree → gitUpdateRefCAS → returns commitSha), and the reason
`'abc123'` now flows from `gitCommitTree.commitSha` (not porcelain `gitCommit`) is explicit. The
return-shape gotcha (each plumbing symbol has a DIFFERENT success shape — treeSha/sha/commitSha) is called
out per-symbol. `@746` is proven to stay green (early-return before gitAdd). The change is file-disjoint
from the parallel P1.M2.T1.S1 and touches no `src/` file. Residual risks: (a) a wrong plumbing return shape
(caught by the targeted vitest run — `result===null` → recheck treeSha/sha/commitSha); (b) an unused-handle
lint flag (avoided by the plumbing-path assertions that consume the handles); (c) a prettier nit
(auto-fixed via `npm run fix`). No runtime/network/LLM unknowns — pure unit test with `vi.fn` mocks.