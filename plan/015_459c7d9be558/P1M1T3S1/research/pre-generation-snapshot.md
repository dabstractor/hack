# Research — P1.M1.T3.S1: Pre-generation snapshot (PARENT_SHA + write-tree → TREE_SHA, identity transparency)

> Plan 015, PRD §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" + §9.10
> "Commit Generation & Agent Tool Safety." This is the **pre-generation step** of the 3-subtask
> `smartCommit` rewrite (S1 pre-gen → S2 post-gen commit-tree+CAS → S3 rescue). S1 captures
> `PARENT_SHA` (`git rev-parse HEAD`, rootless → undefined) + freezes the staged index via
> `gitWriteTree` → `TREE_SHA` (abort-on-conflict BEFORE message gen), with commit-identity
> transparency. The captured values flow to S2; the existing message-gen + `gitCommit` path stays
> intact for this subtask. Architecture: `plan/015_459c7d9be558/architecture/system_context.md §2.1`.

## 0. Scope boundary

- **Files touched:** `src/utils/git-commit.ts` (smartCommit insert + JSDoc) + `src/tools/git-mcp.ts`
  (NEW `gitRevParseHead` plumbing wrapper — see §2) + `tests/unit/utils/git-commit.test.ts` (mock
  factory + import + shared defaults + 1 new fail-fast test).
- **PRE-generation only.** S1 captures PARENT_SHA + TREE_SHA and aborts on conflict; it does NOT
  replace `gitCommit` (that's S2: commit-tree + CAS update-ref) and does NOT add the rescue path (S3).
  After S1, `gitCommit` still runs — the write-tree is captured (its abort-on-conflict is a real
  fail-fast) and TREE_SHA is debug-logged (inert until S2 consumes it).
- **Disjoint from the parallel T2.S1 (ARG_MAX staging):** T2.S1 rewrites the staging block
  (~L620-660); S1 inserts AFTER `restore_critical_files` (L652) and BEFORE message resolution (L654).
  Anchor on `await restore_critical_files(repoRoot);` (T2.S1 leaves it in place) — stable across both.

## 1. Verified current state (src/utils/git-commit.ts — smartCommit L583-733)

- **Signature (unchanged by S1):** `smartCommit(sessionPath, message, options?): Promise<string | null>`.
  Outer `try { … } catch { logger().error(…); return null; }` — the **never-fail-on-commit contract**
  (any unexpected throw → null). S1's abort-on-conflict MUST follow this: log + `return null`.
- **Flow today:** gitStatus → filterProtectedFiles → (skip if empty → null) → gitAdd →
  `restore_critical_files(repoRoot)` (L652) → [message gen: `gitDiff({staged:true})` →
  `retry(generateCommitMessage)` → `formatCommitMessage`, OR `formatCommitMessage(message)`] →
  `gitCommit` (L686) → return `commitHash`.
- **S1 insert point:** immediately AFTER `await restore_critical_files(repoRoot);` (L652) and BEFORE
  the `let formattedMessage: string;` / `if (options?.generateMessage) {` block (L654). This is AFTER
  staging+restore, BEFORE the (slow) message-generation LLM call — so the write-tree abort-on-conflict
  fail-fasts BEFORE spending an LLM call on an uncommittable index.
- **`repoRoot = process.cwd()`** (L596) — all git ops run at the repo root; pass `repoRoot` to the new
  wrappers.

## 2. The plumbing inputs + the missing PARENT_SHA helper

- **Inputs (Complete/Implementing):** `gitWriteTree(repoPath?) → Promise<{success:true, treeSha} | {success:false, error}>`
  (`src/tools/git-mcp.ts:627`, re-exported L1077). `gitCommitTree` (S2 uses) + `gitUpdateRefCAS` (S2
  uses) also live there. Confirmed `gitWriteTree` uses `simpleGit.raw(['write-tree'])` (argv vector —
  satisfies §5.1 no-shell), returns the trimmed 40-char tree SHA; on an index with unresolved merge
  conflicts it returns `{success:false, error:'Cannot write-tree: unresolved merge conflicts …'}`.
- **❗ No existing `git rev-parse HEAD` reader.** `gitStatus`'s `GitStatusResult` (git-mcp.ts:92) does
  NOT carry the current commit SHA. The PRD/contract requires PARENT_SHA = `git rev-parse HEAD`.
- **Layering invariant:** `src/utils/git-commit.ts` consumes git-mcp.ts's wrapped functions — it NEVER
  imports `simpleGit` or runs raw git directly (confirmed by T2.S1's PRP "Reusable helper question —
  answer: NO" + system_context §2.1). So PARENT_SHA capture MUST go through a new git-mcp.ts wrapper,
  not an inline `simpleGit` call in smartCommit.
- **→ Add `gitRevParseHead(repoPath?)` to git-mcp.ts**, mirroring `gitWriteTree` exactly (argv vector,
  structured result, rootless-safe):
  ```ts
  type GitRevParseHeadResult =
    | { success: true; sha: string }
    | { success: false; error: string };

  async function gitRevParseHead(repoPath?: string): Promise<GitRevParseHeadResult> {
    const safePath = await validateRepositoryPath(repoPath);
    const git = simpleGit(safePath);
    try {
      const sha = (await git.raw(['rev-parse', 'HEAD'])).trim();
      return { success: true, sha };
    } catch {
      // HEAD unborn (rootless repo — no commits yet) OR missing ref. PRD §5.1 "Rootless repo":
      // PARENT_SHA empty → commit-tree is called without -p (root commit); update-ref without expected-old.
      return { success: false, error: 'HEAD is unborn (rootless repository — no commits yet)' };
    }
  }
  ```
  Re-export it via the existing `export { … }` block (L1077-1079). (`rev-parse` is a pure read — no
  identity concern; it inherits repo config + process env, never injects `user.*`/`GIT_AUTHOR_*`.)

  **On the contract's "No new exports — internal integration" note:** this refers to `smartCommit`'s
  public surface (signature/return UNCHANGED — internal integration, not a new public function). The
  PARENT_SHA capture is a stated S1 requirement, and the layering invariant forces it through a
  git-mcp.ts wrapper. `gitRevParseHead` is a plumbing primitive in the same family as
  write-tree/commit-tree/update-ref — it belongs in git-mcp.ts. (The alternative — inline `simpleGit`
  in smartCommit — breaks the layering invariant.)

## 3. Ready-to-paste smartCommit insert (after `await restore_critical_files(repoRoot);`, L652)

```ts
    // ── Snapshot-Based Atomic Commit — PRE-GENERATION capture (PRD §5.1, P1.M1.T3.S1) ──
    // Capture PARENT_SHA (current HEAD) BEFORE the (slow) message-generation step, then freeze the
    // staged index into an immutable tree object (TREE_SHA). Both flow to the post-generation
    // commit-tree + CAS update-ref (P1.M1.T3.S2). Capturing BEFORE generation ALSO fail-fast aborts
    // on unresolved merge conflicts (write-tree fails) — never spending an LLM call on an
    // uncommittable index (PRD §5.1 "Unresolved merge conflicts in the index" edge case).
    //
    // Commit-identity transparency (PRD §5.1 / §9.10.1): this path MUST NOT set user.name/user.email
    // or pass GIT_AUTHOR_*/GIT_COMMITTER_* env on any git subprocess — the plumbing wrappers inherit
    // the repo's existing git config only. Every commit is authored as whoever git resolves from the
    // user's own config; a pipeline commit is indistinguishable in metadata from a hand-authored one.
    const headResult = await gitRevParseHead(repoRoot);
    const parentSha = headResult.success ? headResult.sha : undefined; // undefined → root commit (rootless)

    const treeResult = await gitWriteTree(repoRoot);
    if (!treeResult.success) {
      // Unresolved merge conflicts in the index → abort BEFORE message generation (never-fail-on-commit
      // contract: log + return null; do NOT throw — the index/HEAD are byte-for-byte unchanged).
      logger().error(`Smart Commit aborted (unresolved merge conflicts): ${treeResult.error}`);
      return null;
    }
    const treeSha = treeResult.treeSha;
    logger().debug(
      { parentSha: parentSha ?? null, treeSha },
      'Captured pre-generation snapshot (PARENT_SHA + TREE_SHA)'
    );
    // PARENT_SHA + TREE_SHA are consumed by the post-generation commit-tree + CAS update-ref
    // (P1.M1.T3.S2). The existing message-generation + gitCommit path below is UNCHANGED for S1.
```
After this block, the existing `let formattedMessage: string; if (options?.generateMessage) { … }` →
`gitCommit` → `return commitHash` continues verbatim. **No change** to the message-gen or gitCommit path.

## 4. Imports (src/utils/git-commit.ts, top — lines ~24-26)

Add `gitWriteTree` and `gitRevParseHead` to the existing `import { gitStatus, gitAdd, gitCommit, gitDiff, … } from '../tools/git-mcp.js';`:
```ts
  gitStatus,
  gitAdd,
  gitCommit,
  gitDiff,
  gitWriteTree,      // ← NEW (P1.M1.T3.S1 pre-generation snapshot)
  gitRevParseHead,   // ← NEW (P1.M1.T3.S1 PARENT_SHA capture)
  …
```

## 5. JSDoc (Mode A) — smartCommit

Update the `smartCommit` JSDoc block (L526-582) to cite the new mechanics (ADD bullets; keep the
existing never-fail / retry / fallback wording):
- Cite **PRD §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)"**: the commit is a
  `write-tree` → (message gen) → `commit-tree` → CAS `update-ref` sequence; PARENT_SHA + TREE_SHA are
  captured pre-generation (this subtask); the CAS advance is post-generation (P1.M1.T3.S2). Until S2
  lands, `gitCommit` still runs — the snapshot capture + conflict fail-fast are live; the atomic CAS
  advance is S2.
- Cite **§5.1 "Commit-identity transparency" + §9.10.1**: the subsystem MUST NOT set/override/inject
  any git author/committer identity — no `user.name`/`user.email`, no `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
  env on any git subprocess; commits are authored as whoever git resolves from the user's own config.

## 6. Tests (tests/unit/utils/git-commit.test.ts)

### 6a. Mock factory (L20-29) — ADD two stubs
```ts
vi.mock('../../../src/tools/git-mcp.js', () => ({
  gitStatus: vi.fn(),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitDiff: vi.fn(),
  gitListStagedDeletions: vi.fn(),
  gitRestoreFileFromHead: vi.fn(),
  gitUnstagePath: vi.fn(),
  getRecentCommitMessages: vi.fn(),
  gitWriteTree: vi.fn(),     // ← NEW (P1.M1.T3.S1)
  gitRevParseHead: vi.fn(),  // ← NEW (P1.M1.T3.S1)
}));
```
Add `gitWriteTree, gitRevParseHead` to the matching `import { … } from '../../../src/tools/git-mcp.js';` (L60-68).

### 6b. Shared smartCommit mock defaults — CRITICAL (every existing smartCommit test needs these)
The new `gitRevParseHead` + `gitWriteTree` calls run in EVERY smartCommit path. A `vi.fn()` default
returns `undefined` → smartCommit's `headResult.success` / `treeResult.success` access throws → outer
catch → returns `null` → **every existing smartCommit test that expects a commit hash BREAKS**. So in
the shared `beforeEach` (wherever `mockGitStatus.mockResolvedValue({...})` / `mockGitAdd.mockResolvedValue({...})`
are set), ADD:
```ts
vi.mocked(gitRevParseHead).mockResolvedValue({ success: true, sha: 'parent-sha-0001' });
vi.mocked(gitWriteTree).mockResolvedValue({ success: true, treeSha: 'tree-sha-0001' });
```
Existing tests then stay GREEN (the write-tree succeeds; gitCommit still runs as today).

### 6c. NEW test — write-tree conflict fail-fast (TDD: proves the abort-before-generation)
```ts
it('aborts BEFORE message generation when write-tree reports unresolved merge conflicts (P1.M1.T3.S1)', async () => {
  // SETUP — normal status/add/restore succeed; gitRevParseHead ok; write-tree FAILS (conflicts).
  mockGitStatus.mockResolvedValue({ success: true, modified: ['src/a.ts'], untracked: [] });
  mockGitAdd.mockResolvedValue({ success: true });
  vi.mocked(gitRevParseHead).mockResolvedValue({ success: true, sha: 'parent-sha' });
  vi.mocked(gitWriteTree).mockResolvedValue({
    success: false,
    error: 'Cannot write-tree: unresolved merge conflicts in the index — resolve them first',
  });
  const spyGen = vi.spyOn(console, 'warn').mockImplementation(() => {}); // silence if needed

  // EXECUTE
  const result = await smartCommit(tmp, 'msg', { generateMessage: true });

  // VERIFY — never-fail contract: returns null (no throw); and NEVER reached the LLM/commit:
  expect(result).toBeNull();
  expect(generateCommitMessage).not.toHaveBeenCalled();
  expect(gitCommit).not.toHaveBeenCalled();
  spyGen.mockRestore();
});
```
(Also optionally: a rootless-repo test — `gitRevParseHead` returns `{success:false}` → `parentSha === undefined`,
write-tree succeeds, commit proceeds. Proves the undefined-parent path doesn't abort.)

## 7. Identity-transparency confirmation

`gitRevParseHead` + `gitWriteTree` both use `simpleGit.raw([...])` (argv vector, no shell) and inherit
the repo's git config + `process.env`. S1 adds NO `user.name`/`user.email` config write and NO
`GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on either subprocess → identity transparency holds. The structural
self-source-scan guard (PRD §9.10.2) is **P1.M3.T1** (separate); S1's contribution is (a) not injecting
identity and (b) the JSDoc citation. (Note: S1 does NOT emit the commit yet — `gitCommit` still does,
unchanged; the `commit-tree` identity path is S2's concern, and S2's `gitCommitTree` likewise inherits
config without injection.)

## 8. Validation
```bash
npm run test:run -- git-commit         # updated mocks + new fail-fast test GREEN; all existing smartCommit tests GREEN
npm run typecheck                      # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint                           # eslint — clean
npm run format:check                   # prettier — clean
```