# BUG-002 — 8 Stale Tests (Minor, CI Cannot Pass)

All 8 failures are in TEST files, not product code. The implementation is PRD-compliant; the tests encode pre-§4.5.1 / pre-§5.1 behavior. They must be updated so `npx vitest run` is green.

## (a) fix-cycle-workflow.test.ts — 6 failures (1 shared root cause)

### Root cause
Test fixture `createFixSubtask` (line 158) sets `context_scope: 'fix'`. The strict `ContextScopeSchema` (`src/core/models.ts:106`) requires the full `CONTRACT DEFINITION:` prefix + 4 ordered sections (`1. RESEARCH NOTE:`, `2. INPUT:`, `3. LOGIC:`, `4. OUTPUT:`). The value `'fix'` fails validation.

`FixCycleWorkflow.runStandardBreakdown()` (line 273) → `#validateAndHealBacklog()` (line 380) catches the schema failure and runs the §4.5.1 heal path: extra `retryAgentPrompt` (schema-nudge) calls + `#healContextScopes()` + `writeTasksJSON()`, and MUTATES the backlog. This drifts the tests' exact call-count / backlog-equality assertions.

### The 6 failing tests
1. `runStandardBreakdown > creates the architect agent ONCE and invokes it through retryAgentPrompt` — asserts `mockRetryAgentPrompt` called **1×**, but heal adds schema-nudge calls.
2. `runStandardBreakdown > reads tasks.json back, flattens via resolveScope(...), stores subtasks in #fixTasks` — asserts `backlogArg` `toEqual(createFixBacklog([s1, s2]))`, but heal mutated the context_scope.
3. `executeFixes > persists completed fix subtask outcomes ... rolls the status up` — writeTasksJSON count/backlog drift.
4. `executeFixes > marks a failed fix subtask Failed ... (and keeps successful ones Complete)` — same.
5. `executeFixes > uses the bugfix-scoped orchestrator from the factory ...` — same.
6. `executeFixes > falls back to the shared orchestrator + mirror persistence ...` — same.

### Fix
Give `createFixSubtask` a full CONTRACT DEFINITION `context_scope` so the backlog passes `BacklogSchema` on first parse and the heal path is never triggered. Example value:
```
CONTRACT DEFINITION:\n1. RESEARCH NOTE: bugfix fixture.\n2. INPUT: TEST_RESULTS.md.\n3. LOGIC: apply fix.\n4. OUTPUT: patched source.
```
A single fixture change fixes all 6 tests (they all build subtasks via `createFixSubtask`).

## (b) protected-files.test.ts — 1 failure (§5.1 pathspec staging + plumbing)

### Current test (line 709) `should filter all protected files in smart commit workflow`
Asserts per-file staging:
```typescript
expect(mockGitAdd).toHaveBeenCalledWith({
  path: '/project',
  files: ['src/index.ts', 'tasks.json', 'src/utils.ts'],
});
```

### Why it fails
`smartCommit` (`src/utils/git-commit.ts`) now uses **§5.1 ARG_MAX-safe pathspec staging** (line 827): `gitAdd({ path: repoRoot })` with **no `files` key** (→ `git add .`). Actual call is `{ path: '/project' }`.

### IMPORTANT: additional unmocked plumbing functions
The mock factory (lines 22-27) only provides `{ gitStatus, gitAdd, gitCommit }`. After the §5.1 rework, `smartCommit` uses git PLUMBING instead of porcelain `gitCommit`. The full post-gitAdd flow calls (all currently `undefined` → TypeError caught by smartCommit's outer try/catch → returns `null`):
- `gitUnstagePath(excluded, repoRoot)` — line 839, unstage loop over protected files
- `restore_critical_files(repoRoot)` — line 852 (internal; swallows its own errors, but calls `gitListStagedDeletions`/`gitRestoreFileFromHead`/`gitUnstagePath`)
- `gitRevParseHead(repoRoot)` — line 855
- `gitWriteTree(repoRoot)` — line 857 (returns null if !success)
- `gitCommitTree({repoPath, treeSha, message, parentSha})` — line 962 (returns null if !success)
- `gitUpdateRefCAS({repoPath, newSha, expectedOldSha})` — line 976 (throws CommitCasRefusedError if !success)

`gitCommit` is NO LONGER called by `smartCommit` (replaced by commit-tree + CAS). So the existing `mockGitCommit.mockResolvedValue({commitHash:'abc123'})` and any `expect(mockGitCommit)` are stale.

### Fix (more than a 1-line assertion change)
1. Change the `gitAdd` assertion to `expect(mockGitAdd).toHaveBeenCalledWith({ path: '/project' })`.
2. Add mocks for the plumbing functions to the `vi.mock('../../src/tools/git-mcp.js', ...)` factory (or `vi.mocked`): `gitUnstagePath → {success:true}`, `gitRevParseHead → {success:true, sha:'parent-sha'}`, `gitWriteTree → {success:true, treeSha:'tree-sha'}`, `gitCommitTree → {success:true, commitSha:'abc123'}`, `gitUpdateRefCAS → {success:true}`. (`restore_critical_files` swallows errors so its callees need not be functional, but the factory should export the symbols to avoid `undefined` noise; returning `{success:true}` is safe.)
3. Keep `expect(result).toBe('abc123')` — now `'abc123'` comes from `gitCommitTree`'s `commitSha`, not `gitCommit`.
4. Remove the stale `mockGitCommit` setup/assertion if present.

## (c) prp-executor-integration.test.ts — 1 failure (§4.5.1 format-nudge)

### Current test (line 482) `should handle invalid JSON from Coder Agent`
```typescript
mockAgent.prompt.mockResolvedValue('Not valid JSON at all');
// ...
expect(result.error).toContain('Failed to parse Coder Agent response');  // line 497 — STALE
```

### Why it fails
§4.5.1 format-nudge recovery (`src/agents/prp-executor.ts`): a no-envelope response triggers nudges (bounded `FORMAT_NUDGE_MAX = 2`). After exhaustion, the terminal error (line 385) is:
```
Coder Agent did not return a parseable JSON result envelope after 2 format nudge(s) (PRD §4.5.1). Last response: ...
```
The legacy `'Failed to parse Coder Agent response'` (line 866) still exists but is NOT the path reached for a no-envelope response.

### Fix
Change line 497 assertion to the new text:
```typescript
expect(result.error).toContain('did not return a parseable JSON result envelope after 2 format nudge(s)');
```
(`result.success` must still be `false` — already asserted at line 496.)

## Verification
After all 3 file fixes + BUG-001 fix: `npx vitest run` → 0 failed (7328 passed | 71 skipped).