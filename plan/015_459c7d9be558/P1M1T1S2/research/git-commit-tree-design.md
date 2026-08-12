# Research — P1.M1.T1.S2 (`gitCommitTree` — create dangling commit from tree + parent + message)

S2 is the second git-plumbing primitive for the §5.1 snapshot-based atomic commit. S1 (LANDED) added
`gitWriteTree`; S2 adds `gitCommitTree` (step 2 of the 3-step workflow); S3 will add `gitUpdateRefCAS`.
S2 mirrors S1's pattern verbatim (result union, validateRepositoryPath, simpleGit.raw([argv]), trim, catch).

## 1. S1 is LANDED — the pattern to mirror (verified in-repo)

`src/tools/git-mcp.ts` L595-633:
```ts
export type GitWriteTreeResult =
  | { success: true; treeSha: string }
  | { success: false; error: string };

export async function gitWriteTree(repoPath?: string): Promise<GitWriteTreeResult> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  try {
    const output = await git.raw(['write-tree']);   // argv VECTOR (execFile, not sh -c)
    const treeSha = output.trim();                    // raw stdout = SHA + trailing newline
    return { success: true, treeSha };
  } catch {
    return { success: false, error: 'Cannot write-tree: unresolved merge conflicts ...' };
  }
}
```
Exported at L919 (re-export block). JSDoc cites §5.1 step 1, notes the argv-vector rule.

S2 MIRRORS this for `gitCommitTree`:
- Result type: `GitCommitTreeResult = { success: true; commitSha: string } | { success: false; error: string }`.
- Input: `{ treeSha: string; message: string; parentSha?: string; repoPath?: string }` (an object, per contract — NOT positional like gitWriteTree's `repoPath?`).
- Argv: `['commit-tree', treeSha, ...(parentSha ? ['-p', parentSha] : []), '-m', message]`.
- `git.raw(args)` → `.trim()` → `{ success: true, commitSha }`. Catch → `{ success: false, error }`.
- S2 does NOT modify gitWriteTree or any existing function.

## 2. The message-via-`-m` safety (execFile, not shell)

`simpleGit.raw([...])` uses `execFile` internally (NOT `sh -c`) — each array element is a separate
argv arg passed directly to the git process. So a multi-line message (with embedded `\n`) passed as
the `-m` value is SAFE: execFile doesn't interpret newlines as shell delimiters, and git commit-tree's
`-m` preserves embedded newlines as the commit body. This satisfies §5.1's "no shell interpolation"
rule WITHOUT needing stdin — the message is simply an argv element. (For very large messages, stdin
is an alternative, but `-m` via argv is sufficient for all realistic commit messages.)

## 3. The argv ordering (git commit-tree syntax)

`git commit-tree <tree> [-p <parent>]... [-m <msg>]` — the tree is the first positional; `-p` and `-m`
are flags that follow. S2 builds: `['commit-tree', treeSha, ...(parentSha ? ['-p', parentSha] : []), '-m', message]`.
When parentSha is omitted (rootless repo / first commit), no `-p` is emitted → git creates a root commit.

## 4. validateRepositoryPath + simpleGit (verified usage pattern)

- `validateRepositoryPath(repoPath?)` at L202 — validates path exists + `.git` present → returns
  resolved abs path. Used by gitWriteTree (L630), getRecentCommitMessages (L588), gitStatus (L338), etc.
- `simpleGit(safePath)` — creates a simple-git instance bound to the repo. Already imported (L24).
- `git.raw([...])` — the raw-plumbing API (first used by gitWriteTree L633). Returns raw stdout string.

## 5. The test file (tests/unit/tools/git-mcp.test.ts, 1341 lines)

- Mocks `node:fs` (existsSync/realpathSync → true/identity) AND `simple-git` (→ mockGitInstance).
- `mockGitInstance` (L70) has `raw: vi.fn()` (L79) — mock via `mockGitInstance.raw.mockResolvedValue('<sha>\n')`
  (success) or `mockGitInstance.raw.mockRejectedValue(new Error('...'))` (failure).
- Assert the argv: `expect(mockGitInstance.raw).toHaveBeenCalledWith(['commit-tree', treeSha, '-p', parentSha, '-m', message])`.
- S1 did NOT add gitWriteTree tests (S1's PRP: "no existing test touches it yet"). S2 adds gitCommitTree
  tests; the smartCommit rewrite (P1.M1.T3) adds the integration tests that chain all 3 primitives.
- Error-test precedent: gitStatus tests reject with GitError (L329), Error (L342), and string (L355) —
  so both Error and non-Error rejection paths are coverable.

## 6. S2's test cases (for 100% coverage of the new function)

1. Success WITH parent: raw resolves '<sha>\n' → { success: true, commitSha: '<sha>' }; raw called with
   ['commit-tree', treeSha, '-p', parentSha, '-m', message].
2. Success WITHOUT parent (rootless): raw resolves '<sha>\n' → { success: true, commitSha }; raw called
   with ['commit-tree', treeSha, '-m', message] (NO -p).
3. Multi-line message: message with '\n' → raw called with the message verbatim (proves no shell split).
4. .trim(): raw resolves '<sha>\n' (trailing newline) → commitSha === '<sha>' (trimmed, no newline).
5. Failure (Error): raw rejects with new Error('fatal: not a valid object name') → { success: false,
   error: 'fatal: not a valid object name' }.
6. Failure (non-Error): raw rejects with 'string error' → { success: false, error: 'string error' }.

Cases 1+2 cover the parentSha ternary (truthy/falsy). Cases 5+6 cover the catch (Error/non-Error).
Case 4 covers .trim(). All branches hit → 100% function + branch coverage on gitCommitTree.

## 7. Error handling design (catch with message extraction)

Unlike gitWriteTree (which has ONE failure mode → fixed message), gitCommitTree has MULTIPLE failure
modes (bad tree SHA, bad parent SHA, git internal error). So the catch EXTRACTS the error message
(informative for debugging) rather than returning a fixed string:
```ts
catch (e) {
  return { success: false, error: e instanceof Error ? e.message : String(e) };
}
```
The `instanceof Error` branch needs BOTH an Error rejection (case 5) and a non-Error rejection (case 6)
for 100% branch coverage — both are in the test plan, and the test file has precedent for both (L329/L355).

## 8. Scope boundaries

- S2 = gitCommitTree + GitCommitTreeResult + JSDoc + tests. NOTHING else.
- S1 (landed) = gitWriteTree. Do NOT modify it.
- S3 = gitUpdateRefCAS (the CAS update-ref). Separate.
- P1.M1.T3 = the smartCommit rewrite that CHAINS write-tree → commit-tree → update-ref. Separate.
- No ref mutation (commit-tree creates a DANGLING commit — it does NOT advance HEAD). That's S3's job.

## 9. Validation

- `npm run typecheck` / `npm run lint` / `npm run format:check` (prettier ERROR-enforced; `npm run fix`).
- `npx vitest run tests/unit/tools/git-mcp.test.ts` (S2 additions + regression; 100% coverage).