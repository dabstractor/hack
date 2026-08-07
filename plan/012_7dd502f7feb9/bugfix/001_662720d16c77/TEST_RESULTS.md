# Bug Fix Requirements

## Overview
I validated session 012 (PRD 011→012 delta: the PRP_COMMIT_STYLE "Commit Message Style" layer + the `hack update` manual-status command) end-to-end against the PRD. The two defects in the prior validation report (BUG-1 `hack update` pipeline fallthrough, BUG-2 docs drift to spec/SPEC.md) were both fixed in commit f6e5ae5 — I verified `hack update` no longer starts the PRPPipeline and confirmed the docs now reference spec/SPEC.md. I then exhaustively tested the delta scope: `hack update` fuzzy ID/status matching, downward Complete cascade, bottom-up min-status ancestor recompute (including downgrade, Failed-excluded-unless-all-failed, Obsolete terminal handling), the non-settable `Retrying` status, unknown/ambiguous error paths, the `.hack` loader for the two new [pipeline] keys, out-of-range/type-mismatch validation, and the commit-style system-prompt builder across all four modes (plain/conventional/gitmoji/auto, including ≤1-commit degradation, EXAMPLES=0 disable, anti-reuse, ignore-position-prefix, gitmoji reference table). All of those behave per spec. However, I found ONE CRITICAL defect that the existing test suite is completely blind to (mock masking): `getRecentCommitMessages()` uses `{ maxEntries: count }`, which is not a valid simple-git option — the correct property is `maxCount`. Under the DEFAULT config (`PRP_COMMIT_STYLE=auto`, `PRP_COMMIT_STYLE_EXAMPLES=5`) this throws on every commit, so the entire `auto` style feature (the headline feature of this delta) never runs and every pipeline commit silently degrades to the generic `chore: commit-gen failed (exit 0); fallback commit` placeholder, losing the descriptive message. The fix is a one-character-class change at src/tools/git-mcp.ts:590 plus correcting the test assertion at git-mcp.test.ts:977.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

### Issue 1: getRecentCommitMessages() passes an invalid simple-git option (`maxEntries` instead of `maxCount`), which makes the DEFAULT `auto` commit-style throw on every commit and silently fall back to the placeholder message
**Severity**: Critical
**ID**: BUG-001
**Location**: src/tools/git-mcp.ts:590 (root cause); masked by tests/unit/tools/git-mcp.test.ts:977 and tests/unit/utils/git-commit.test.ts:28

**Description**:
The headline feature of session 012 is the PRD §5.1 "Commit Message Style" layer. Its DEFAULT mode is `auto`, whose contract (PRD §5.1) is: "The Smart Commit generation request MUST include the last PRP_COMMIT_STYLE_EXAMPLES (default 5) commit messages from the repository as style examples." To fetch those examples, `generateCommitMessage()` (`src/utils/git-commit.ts:358-360`) calls `getRecentCommitMessages(n)` whenever `getPrpCommitStyle() === 'auto'` (the default) and `getPrpCommitStyleExamples() > 0` (the default is 5). `getRecentCommitMessages()` (`src/tools/git-mcp.ts:583-593`) does `git.log({ maxEntries: count })`. But simple-git 3.30.0's `LogOptions` interface (node_modules/simple-git/dist/src/lib/tasks/log.d.ts) defines the property as `maxCount?: number`, NOT `maxEntries`. simple-git therefore passes the unrecognized key through as a literal positional git argument, so for ANY count > 0 git aborts with `fatal: ambiguous argument 'maxEntries=5': unknown revision or path not in the working tree.` This is an uncaught bare `await` inside `generateCommitMessage`, so the throw propagates out to `smartCommit`'s retry wrapper (`src/utils/git-commit.ts:673`). `isTransientError()` classifies the git message as non-transient, so `retry()` rethrows on the first attempt; the catch at `src/utils/git-commit.ts:687-700` then discards generation entirely and commits the last-resort placeholder `chore: commit-gen failed (exit 0); fallback commit` via `buildFallbackCommitMessage`. NET EFFECT: under the default configuration, on any repository with >1 commit (every real repo), EVERY pipeline commit (pre-cleanup commit §4.2, post-cleanup commit, and bug-hunt workflow commit — `smartCommit({generateMessage:true})` at `src/core/task-orchestrator.ts:801,1064,1119` and `src/workflows/bug-hunt-workflow.ts:503`) loses its LLM-generated descriptive message and becomes the generic placeholder. The `auto` style feature is 100% non-functional, and it is a regression versus the pre-style behavior (where `generateCommitMessage` never called `getRecentCommitMessages` and plain generation worked). The explicit modes `plain`/`conventional`/`gitmoji` and `PRP_COMMIT_STYLE_EXAMPLES=0` avoid the bug because they skip `getRecentCommitMessages`, but `auto` is the documented DEFAULT, so out-of-the-box behavior is broken. The PRD clause violated: §5.1 "Commit Message Style (Learning & Explicit Modes)" — the `auto` mode is specified to learn from history and emit a styled descriptive message; instead it throws and emits no descriptive message at all. NOTE on why CI is green: the unit test `tests/unit/tools/git-mcp.test.ts:977` asserts the broken API contract verbatim — `expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 })` — against a vi.fn mock that ignores its argument, so the test passes while validating the wrong option name. The git-commit tests additionally mock `getRecentCommitMessages` to `vi.fn()` (tests/unit/utils/git-commit.test.ts:28), so neither layer ever exercises real simple-git. FIX: change `{ maxEntries: count }` to `{ maxCount: count }` at src/tools/git-mcp.ts:590 (verified empirically — `git.log({maxCount:5})` returns the 5 newest commits correctly) and correct the test assertion at git-mcp.test.ts:977 to `{ maxCount: 2 }`.

**Steps to Reproduce**:
1. From the repo root, confirm simple-git rejects `maxEntries`:
   `npx tsx -e "import simpleGit from 'simple-git'; const g=simpleGit(process.cwd()); try{const r=await g.log({maxEntries:3}); console.log('ok',r.all.length)}catch(e){console.log('THREW:',(e as Error).message.split(String.fromCharCode(10))[0])}"`
   => prints `THREW: fatal: ambiguous argument 'maxEntries=3': unknown revision or path not in the working tree.`
2. Confirm `maxCount` works: same one-liner with `{maxCount:3}` => prints `ok 3`.
3. Confirm the default-config path hits the throw (real getters + real getRecentCommitMessages, env unset):
   `npx tsx -e "delete process.env.PRP_COMMIT_STYLE; delete process.env.PRP_COMMIT_STYLE_EXAMPLES; const c=await import('./src/config/constants.ts'); const g=await import('./src/tools/git-mcp.ts'); const s=c.getPrpCommitStyle(); const n=c.getPrpCommitStyleExamples(); console.log('style='+s+' n='+n); try{await g.getRecentCommitMessages(n); console.log('no throw')}catch(e){console.log('THREW:',(e as Error).message.split(String.fromCharCode(10))[0])}"`
   => prints `style=auto n=5` then `THREW: fatal: ambiguous argument 'maxEntries=5'...` — proving `generateCommitMessage` throws under the exact default config, before the agent is ever invoked.
4. The thrown git error is non-transient, so `smartCommit` falls through to `buildFallbackCommitMessage()` (`src/utils/git-commit.ts:424-432`) => `chore: commit-gen failed (exit 0); fallback commit`.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

None.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

None.

## Testing Summary
- Total bugs found: 1
- Critical: 1
- Major: 0
- Minor: 0

## Recommendations
- Change `{ maxEntries: count }` to `{ maxCount: count }` in src/tools/git-mcp.ts:590 and update the test assertion at tests/unit/tools/git-mcp.test.ts:977 from `{ maxEntries: 2 }` to `{ maxCount: 2 }`.
- Add an integration test that calls the REAL simple-git (not a vi.fn mock) against a throwaway temp git repo, so an invalid option name fails the build instead of being masked by a mock that ignores its argument.
- Add an end-to-end test that drives generateCommitMessage under the default `auto` config (with only the LLM agent mocked) and asserts it does not throw on a repo with >1 commit.
