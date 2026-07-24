# Research 01 — simple-git Mechanics for restore_critical_files

Verified against the **installed** `simple-git@3.30.0` compiled source
(`node_modules/simple-git/dist/esm/index.js` + typings), which is more
authoritative than the GitHub README.

Source: full brief at
`.pi-subagents/artifacts/outputs/31e9536f/research.md`.

## Q1 — List staged deletions (primary)

`git.diff()` is a `straightThroughStringTask` that returns the **raw string**
output of `git diff`. It **rejects a single-string argument** with
`TaskConfigurationError` — MUST pass an array. Output is **not trimmed by
default** → must split + filter empties.

```ts
const raw = await git.diff(['--cached', '--diff-filter=D', '--name-only']);
const stagedDeletions = raw.split('\n').map(s => s.trim()).filter(Boolean);
```

Shell equivalent: `git diff --cached --diff-filter=D --name-only`. ✅

### Structured alternative (git.status)

Staged deletion ⇒ `file.index === 'D'` && `file.working_dir === ' '`.
⚠️ **HIGH PITFALL:** `status.deleted[]` is populated for BOTH staged (`D·`)
and unstaged (`·D`) deletions — do NOT use `status.deleted[]` alone.

```ts
const stagedDeletions = (await git.status()).files
  .filter(f => f.index === 'D' && f.working_dir === ' ')
  .map(f => f.path);
```

**Recommendation:** Use `git.diff(['--cached','--diff-filter=D','--name-only'])`
— the filter self-documents "staged + deletion" with zero staged-vs-unstaged
ambiguity.

## Q2a — Restore a HEAD-tracked deleted file (undo staged deletion)

Use `git.checkout(['HEAD', '--', path])` — clears the staged deletion in the
index AND restores the working tree in ONE call (see Q4).

⚠️ **HIGH PITFALL:** the varargs form `git.checkout('HEAD', '--', path)` is
**silently lossy** — `getTrailingOptions` keeps only the first primitive and
drops `'--'`/`path`, producing `git checkout HEAD` (branch switch!). **Always
pass an array.**

### BLOCKER: `gitRestoreFile()` (src/tools/git-mcp.ts:582) is INSUFFICIENT

```ts
async function gitRestoreFile(filePath, commit='HEAD', repoPath?) {
  const git = simpleGit(safePath);
  const content = await git.show(`${commit}:${filePath}`);  // reads blob
  await atomicWrite(resolve(safePath, filePath), content);  // WORKING TREE ONLY
}
```

`git.show` + `atomicWrite` writes the working tree **only** and never touches
the git index. After `git add -A` staged the deletion, the index entry is
"deleted" (`index === 'D'`). `gitRestoreFile()` puts bytes back on disk but the
index STILL records the staged deletion → `git commit` would still commit the
deletion.

> **gitRestoreFile alone is INSUFFICIENT to undo a staged deletion; you must
> also clear the index.**

Options to fully undo:
1. `git.checkout(['HEAD', '--', path])` — one-shot (preferred), OR
2. Keep `gitRestoreFile()` + additionally `git.add(path)` to re-stage restored
   content (this is the contract's "(or gitRestoreFile)" branch).

## Q2b — Unstage a never-in-HEAD deletion

`git reset HEAD -- <pathspec>` unstages the path's index entry. If the path is
**not in HEAD**, the index entry is simply removed (becomes untracked/absent).
Exit 0, no error.

```ts
await git.reset(['HEAD', '--', path]);   // = git reset HEAD -- <path>
```

⚠️ Do NOT use `git.reset([path])` (no HEAD/`--`) — ambiguous/unreliable.
`git.rmKeepLocal()` (`git rm --cached`) is the WRONG tool — errors on phantom
entries.

## Q3 — Detect existence in HEAD (non-throwing)

simple-git has **NO `.lsFiles()` method** and **NO `.restore()` method**
(verified against the `SimpleGit` interface typedef + `functionNamesPromiseApi`).

Non-throwing check via `git ls-tree` through `.raw()` (exit 0, empty output ⇒
absent):

```ts
async function existsInHead(git: SimpleGit, path: string): Promise<boolean> {
  const out = await git.raw(['ls-tree', '--name-only', 'HEAD', '--', path]);
  return out.trim().length > 0;
}
```

`catFile(['-e', 'HEAD:path'])` works but THROWS when absent (exit 128).
`show('HEAD:path')` also throws. Prefer `ls-tree`.

## Q4 — Pitfall: single `checkout` restores BOTH index + working tree?

**CONFIRMED YES.** `git checkout HEAD -- <pathspec>` overwrites the path in
both the index and the working tree. After this single call, `git status`
shows the path clean. Strictly preferable to `gitRestoreFile()` for the safety
layer.

## Blockers / API facts

- simple-git@3.30.0 has **no `.restore()` method** and **no `.lsFiles()**
  method** — calling either throws `TypeError`.
- `gitRestoreFile()` (existing) is index-blind → INSUFFICIENT to undo a staged
  deletion.

## `**/PRP.md` globbing note

`git diff --name-only` returns **literal** repo-relative paths, not globs. To
match `**/PRP.md`, either intersect the deletion list with concrete paths from
`fast-glob` (already a dep), or filter each deleted path with a basename
check (`basename(p) === 'PRP.md'`). **Simplest + glob-noise-free: basename
match** (`p === 'PRD.md' || basename(p) === 'PRP.md'`) — no fast-glob needed,
no node_modules false positives.

## Sources

- Installed: `node_modules/simple-git/dist/esm/index.js`,
  `dist/typings/simple-git.d.ts`, `dist/typings/response.d.ts`
- `src/tools/git-mcp.ts` (gitRestoreFile, gitReadFileAtCommit, gitStatus)
- `package.json` pins `simple-git@^3.30.0`
- https://git-scm.com/docs/git-status#_short_format (XY codes; `D ` staged)
- https://git-scm.com/docs/git-checkout#_description (overwrites index + worktree)
- https://git-scm.com/docs/git-reset (unstages; no error when path absent)
- https://git-scm.com/docs/git-ls-tree (exit 0, empty output when absent)
- simple-git repo: https://github.com/steveukx/git-js