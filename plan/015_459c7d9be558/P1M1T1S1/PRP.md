# PRP — P1.M1.T1.S1: `gitWriteTree` — freeze index into immutable tree object

> Foundation primitive for the §5.1 snapshot-based atomic commit workflow. `gitWriteTree` wraps
> `git write-tree` via `simpleGit.raw(['write-tree'])` — freezes the current index into an immutable
> tree object (TREE_SHA) without touching HEAD or the staging area. Consumed by P1.M1.T3.S1
> (the smartCommit rewrite's pre-generation snapshot step).

---

## Goal

**Feature Goal**: Add an exported `gitWriteTree(repoPath?)` function to `src/tools/git-mcp.ts` that
runs `git write-tree` via `simpleGit.raw(['write-tree'])`, returning `{ success: true, treeSha }` on
success or `{ success: false, error }` when the index has unresolved merge conflicts.

**Deliverable**: `src/tools/git-mcp.ts` — `GitWriteTreeResult` type + `gitWriteTree` async function + JSDoc.
Consumed by P1.M1.T3.S1 (smartCommit rewrite). S2/S3 add `gitCommitTree` and `gitUpdateRefCAS`.

**Success Definition**:
- `gitWriteTree()` returns the 40-char tree SHA from `git write-tree`.
- On a repo with unresolved merge conflicts, returns `{ success: false, error: '...' }`.
- Uses `validateRepositoryPath` + `simpleGit(safePath).raw(['write-tree'])` — follows the existing
  `gitStatus` pattern. Built as an argv vector (never shell-interpolated).
- `npm run typecheck` clean; existing git-mcp tests unaffected.

---

## Why

- **Foundation for the §5.1 atomic commit.** The snapshot-based workflow is `write-tree` →
  `commit-tree` → CAS `update-ref`. `write-tree` freezes the index at time T — the committed content
  is exactly what was staged, decoupled from any later staging or generation. Without it, the pipeline
  must use `git commit` (which reads the index at commit time, coupling staging and generation and
  risking half-applied state).
- **Pure w.r.t. refs and index.** `write-tree` creates a tree object but modifies neither HEAD nor the
  staging area. A failed/slow generation step after it cannot corrupt history or lose staged work.
- **Scope discipline.** S1 = `gitWriteTree` ONLY. S2 = `gitCommitTree`, S3 = `gitUpdateRefCAS`,
  P1.M1.T3 = smartCommit rewrite. S1 is a self-contained primitive.

---

## What

### Technical requirements (exact contract)

**File:** `src/tools/git-mcp.ts`. Append near the other git operations (after `gitStatus` or
wherever the file's exported functions are grouped).

**Result type + function:**
```ts
export type GitWriteTreeResult =
  | { success: true; treeSha: string }
  | { success: false; error: string };

export async function gitWriteTree(repoPath?: string): Promise<GitWriteTreeResult> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  try {
    const output = await git.raw(['write-tree']); // returns the tree SHA + trailing newline
    const treeSha = output.trim();
    return { success: true, treeSha };
  } catch {
    return {
      success: false,
      error: 'Cannot write-tree: unresolved merge conflicts in the index — resolve them first',
    };
  }
}
```

**Key points:**
- `git.raw(['write-tree'])` uses `execFile` internally (NOT `sh -c`) — satisfies §5.1's no-shell rule.
- `write-tree` outputs the 40-char tree SHA + `\n`; `.trim()` removes the newline.
- On failure (unresolved merge conflicts), `write-tree` exits non-zero → the catch returns the
  structured error. The error message is actionable per §5.1.
- No `git add`, no ref mutation, no index modification — `write-tree` is pure.

**JSDoc:** cite §5.1: "git write-tree — freeze the current index into an immutable tree object
(TREE_SHA). Pure with respect to refs and the index: records what was staged at time T without
modifying HEAD or the staging area."

### Success Criteria
- [ ] `GitWriteTreeResult` type + `gitWriteTree` exported from `src/tools/git-mcp.ts`.
- [ ] Uses `validateRepositoryPath` + `simpleGit(safePath).raw(['write-tree'])` (mirrors gitStatus).
- [ ] Returns `{ success: true, treeSha }` with a 40-char SHA on a clean repo.
- [ ] Returns `{ success: false, error }` with the actionable conflict message on a conflicted index.
- [ ] `npm run typecheck` clean.

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ — the §5.1 commit workflow spec
- docfile: PRD.md  # or the <selected_prd_content> §5.1 "Commit Workflow Mechanics"
  section: "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" step 1
  why: Defines write-tree as step 1 of the atomic commit: "freeze the current index into an immutable
        tree object (TREE_SHA). Pure with respect to refs and the index."
  critical: write-tree is the SNAPSHOT step — it must not touch HEAD or the staging area.

# PATTERN FILE — the only file edited
- file: src/tools/git-mcp.ts
  why: validateRepositoryPath at :202 (reuse it). gitStatus at ~:336 (follow its pattern:
        const safePath = await validateRepositoryPath(path); const git = simpleGit(safePath);).
        NO .raw() calls exist yet — this is the first raw-plumbing function in the file.
  pattern: "const safePath = await validateRepositoryPath(input.path); const git = simpleGit(safePath); const status = await git.status();"
  gotcha: git.raw(['write-tree']) returns a STRING (the tree SHA + newline), NOT a parsed object.
        .trim() the output. The catch is a generic catch (write-tree's non-zero exit is not a typed error).

# VERIFIED FACTS
- fact: "simpleGit.raw() uses execFile internally (NOT sh -c) — satisfies §5.1's argv-vector rule."
- fact: "validateRepositoryPath (line 202) validates path exists + .git present → returns resolved abs path."
- fact: "No .raw() calls exist in git-mcp.ts today — this is the first raw-plumbing function."
- fact: "write-tree fails (non-zero exit) when the index has unresolved merge conflicts — that's the only failure mode."
```

### Known Gotchas
```ts
// CRITICAL — use git.raw(['write-tree']) (an argv array), NOT git.raw('write-tree') (a single string
//   that simple-git may split differently). The array form is the argv-vector pattern §5.1 mandates.

// GOTCHA — git.raw() returns the raw stdout STRING (tree SHA + trailing newline), not a Result object.
//   .trim() it. Don't try to parse it as JSON or a structured type.

// GOTCHA — the catch is generic (no typed error). write-tree's non-zero exit comes through as a
//   simple-git error whose message contains the git stderr. The contract only requires returning the
//   structured { success: false, error } — do NOT inspect or re-throw the raw error message.

// GOTCHA — this is the FIRST raw-plumbing function in git-mcp.ts. simpleGit(safePath).raw([...]) is
//   the correct API; ensure `simpleGit` is already imported (it is — gitStatus uses it).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.
```

---

## Implementation Blueprint

### Tasks

```yaml
Task 1: EDIT src/tools/git-mcp.ts — add GitWriteTreeResult + gitWriteTree
  - APPEND the GitWriteTreeResult type (success+treeSha | success+error union).
  - APPEND the gitWriteTree async function using validateRepositoryPath + simpleGit.raw(['write-tree']).
  - ADD JSDoc citing §5.1 step 1.
  - PLACE near the other exported git operations (after gitStatus or in the file's function group).
  - DO NOT modify any existing function.

Task 2: VERIFY
  - RUN: npm run fix → npm run typecheck.
  - RUN: npx vitest run tests/unit/tools/git-mcp.test.ts → green (no behavior change to existing fns).
  - EXPECTED: clean. The new function is additive — no existing test touches it yet (S2/S3 and the
        smartCommit rewrite in P1.M1.T3 add the tests that exercise it).
```

---

## Validation Loop

```bash
npm run fix && npm run typecheck
npx vitest run tests/unit/tools/git-mcp.test.ts   # existing tests unaffected (additive)
# Expected: clean. A new exported function cannot break existing tests.
```

---

## Final Validation Checklist
- [ ] `GitWriteTreeResult` + `gitWriteTree` exported.
- [ ] Uses `validateRepositoryPath` + `simpleGit(safePath).raw(['write-tree'])`.
- [ ] Returns trimmed tree SHA on success; structured error on merge-conflict failure.
- [ ] JSDoc cites §5.1.
- [ ] `npm run typecheck` clean; existing git-mcp tests green.

---

## Anti-Patterns to Avoid
- ❌ Don't use `git.raw('write-tree')` (string) — use `git.raw(['write-tree'])` (argv array, §5.1).
- ❌ Don't forget `.trim()` — raw output has a trailing newline.
- ❌ Don't re-throw the error — return the structured `{ success: false, error }` per the contract.
- ❌ Don't modify HEAD, the index, or any ref — write-tree is pure.
- ❌ Don't touch existing functions — S1 is purely additive.

---

## Confidence Score
**10/10** — a single additive function wrapping `simpleGit.raw(['write-tree'])`, following the
existing `validateRepositoryPath + simpleGit` pattern verbatim, with a clear success/error contract.
No external/runtime unknowns.