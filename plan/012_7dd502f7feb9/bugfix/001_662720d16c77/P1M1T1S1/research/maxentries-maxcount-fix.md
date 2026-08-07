# Research — P1.M1.T1.S1 (getRecentCommitMessages: maxEntries → maxCount)

Bugfix 001 BUG-001 (CRITICAL): `getRecentCommitMessages()` passes an invalid
simple-git option, making the DEFAULT `auto` commit-style throw on every commit.
S1 is the one-token source fix.

## 1. Root cause (verified)

`src/tools/git-mcp.ts`, function `getRecentCommitMessages(count, repoPath?)`
(lines ~583–593):
```ts
const logResult = await git.log({ maxEntries: count });   // ← WRONG option key
return logResult.all.map(entry => entry.message);
```
simple-git 3.30.0's `LogOptions` interface
(`node_modules/simple-git/dist/src/lib/tasks/log.d.ts:17`) defines:
```ts
maxCount?: number;
```
There is NO `maxEntries` property. simple-git passes the unrecognized key through
as a literal positional git argument → `git log maxEntries=5` →
`fatal: ambiguous argument 'maxEntries=5': unknown revision or path not in the
working tree.` → throws.

**Typecheck doesn't catch it** because the `git.log()` call site isn't excess-
property-checked at compile time (simple-git's option typing is permissive at the
call boundary); the bug is runtime-only. So `npm run typecheck` is green today.

## 2. Why this breaks the DEFAULT `auto` commit-style (the headline §5.1 feature)

Under default config (`PRP_COMMIT_STYLE=auto`, `PRP_COMMIT_STYLE_EXAMPLES=5`):
`generateCommitMessage()` (`src/utils/git-commit.ts:358-360`) calls
`getRecentCommitMessages(5)` → throws → propagates through `smartCommit`'s retry
wrapper → `isTransientError()` classifies the git message as non-transient →
rethrow on first attempt → catch at `git-commit.ts:687-700` discards generation →
`buildFallbackCommitMessage()` → every commit becomes the generic placeholder
`chore: commit-gen failed (exit 0); fallback commit`. The `auto` feature is 100%
non-functional; explicit modes (`plain`/`conventional`/`gitmoji`) and
`PRP_COMMIT_STYLE_EXAMPLES=0` skip `getRecentCommitMessages` and are unaffected.

## 3. The fix (S1 scope = ONE token, source only)

Change `git-mcp.ts:~593` from `{ maxEntries: count }` to `{ maxCount: count }`.
Nothing else changes — the signature, the `count === 0` short-circuit, the
`validateRepositoryPath` call, the `logResult.all.map(...)` return, and the JSDoc
are all untouched. This aligns the call with the simple-git `LogOptions` contract.

## 4. ⚠️ EXPECTED transient test failure owned by S2

`tests/unit/tools/git-mcp.test.ts:977` asserts the BROKEN contract verbatim:
`expect(mockGitInstance.log).toHaveBeenCalledWith({ maxEntries: 2 })`. After S1's
source change, the mock is called with `{ maxCount: 2 }`, so this assertion FAILS.
**That failure is EXPECTED and is fixed in P1.M1.T1.S2** (the immediately-following
subtask, which corrects the assertion to `{ maxCount: 2 }`). S1 deliberately does
NOT touch the test (scope boundary). So S1's gate is NOT "test suite green" — it is:
- `npm run typecheck` clean.
- Empirical smoke: `getRecentCommitMessages(5)` no longer throws (returns commit msgs).
- Acknowledge `git-mcp.test.ts:977` is red until S2 (do NOT "fix" it in S1).

The `git-commit.test.ts` layer mocks `getRecentCommitMessages` to `vi.fn()`
(`tests/unit/utils/git-commit.test.ts:28`), so it never sees this bug and stays green.

## 5. AGENTS.md Rule 5 — out-of-spec corrective fix

This is a bug in existing behavior (the option name never matched the simple-git
contract), not a new feature. Per project AGENTS.md Rule 5, an out-of-spec
corrective fix may be applied directly without a PRD entry (a bugfix-section entry
is welcome but not blocking). The fix restores the behavior the §5.1 feature
specified (learn-from-history `auto` mode) — it does not add new behavior.

## 6. Validation

- `npm run typecheck` → exit 0 (the change aligns with `LogOptions`; typecheck was
  green before and stays green after — the bug is runtime-only).
- Empirical smoke (real simple-git, no mock): `getRecentCommitMessages(5)` returns
  an array of ≤5 commit messages without throwing.
- DO NOT run `npx vitest run tests/unit/tools/git-mcp.test.ts` as a green-gate —
  `:977` will FAIL until S2. (You may run it to CONFIRM the single expected failure.)