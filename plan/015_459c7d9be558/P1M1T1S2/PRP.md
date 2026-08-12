# PRP — P1.M1.T1.S2: `gitCommitTree` — create dangling commit from tree + parent + message

> Foundation primitive for the §5.1 snapshot-based atomic commit workflow (step 2 of 3). S1 (LANDED)
> added `gitWriteTree` (freeze index → TREE_SHA); **S2 adds `gitCommitTree`** (create a dangling commit
> from TREE_SHA + optional PARENT_SHA + message via `git commit-tree`). S3 adds `gitUpdateRefCAS` (the
> CAS HEAD advance). S2 mirrors S1's pattern verbatim. Consumed by P1.M1.T3.S2 (the smartCommit rewrite's
> post-generation commit step).

---

## Goal

**Feature Goal**: Add an exported `gitCommitTree(input)` function to `src/tools/git-mcp.ts` that runs
`git commit-tree <tree> [-p <parent>] -m <msg>` via `simpleGit.raw([argv])`, returning
`{ success: true, commitSha }` on success or `{ success: false, error }` on failure. The commit is
DANGLING (touches no ref — HEAD advance is S3's `gitUpdateRefCAS`). The message travels as an argv
element (execFile, not shell — safe for embedded newlines).

**Deliverable**:
1. **`src/tools/git-mcp.ts`** — `GitCommitTreeResult` type + `gitCommitTree` async function + JSDoc.
2. **`tests/unit/tools/git-mcp.test.ts`** — a `describe('gitCommitTree', …)` block covering
   success-with-parent, success-without-parent (rootless), multi-line message, trim, and Error/non-Error
   failure paths.

**Success Definition**:
- `gitCommitTree({ treeSha, message, parentSha })` returns `{ success: true, commitSha }` (trimmed
  40-char SHA); `raw` called with `['commit-tree', treeSha, '-p', parentSha, '-m', message]`.
- Without `parentSha` (rootless/first commit), `raw` called with `['commit-tree', treeSha, '-m', message]`
  (no `-p`).
- A multi-line message (embedded `\n`) is passed VERBATIM as the `-m` argv element (no shell split).
- On failure (bad SHA, git error), returns `{ success: false, error }` with the git error message.
- Uses `validateRepositoryPath` + `simpleGit(safePath).raw([argv])` (mirrors gitWriteTree).
- `npm run typecheck && npm run lint && npm run format:check` clean; git-mcp tests green at 100% coverage.

---

## Why

- **Foundation for the §5.1 atomic commit (step 2).** The snapshot-based workflow is `write-tree` →
  `commit-tree` → CAS `update-ref`. `commit-tree` creates a commit object from the frozen tree + parent +
  message — it touches NO ref, so the commit is dangling until S3's `update-ref` advances HEAD. This
  decoupling is what makes the commit atomic: a failed/slow generation step after `write-tree` cannot
  corrupt history, and `commit-tree` itself never moves HEAD.
- **Mirrors S1's proven pattern.** `gitWriteTree` (L595-633) established the exact shape: result union,
  `validateRepositoryPath` + `simpleGit.raw([argv])` + `.trim()` + structured catch. S2 follows it.
- **Message safety (§5.1 no-shell rule).** `simpleGit.raw([...])` uses `execFile` (argv vector, NOT
  `sh -c`), so the message — even with embedded newlines — is safe as an `-m` argv element. No stdin
  piping needed; no shell-injection surface.
- **Scope discipline.** S2 = `gitCommitTree` ONLY. S1 = `gitWriteTree` (landed). S3 = `gitUpdateRefCAS`.
  P1.M1.T3 = smartCommit rewrite (chains all 3). S2 is a self-contained primitive.

---

## What

### Technical requirements (exact contract)

**File:** `src/tools/git-mcp.ts`. Append after `gitWriteTree` (~L640) or near the other exported git
operations.

**Result type + function:**
```ts
export type GitCommitTreeResult =
  | { success: true; commitSha: string }
  | { success: false; error: string };

export async function gitCommitTree(input: {
  treeSha: string;
  message: string;
  parentSha?: string;
  repoPath?: string;
}): Promise<GitCommitTreeResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'commit-tree',
    input.treeSha,
    ...(input.parentSha ? ['-p', input.parentSha] : []),
    '-m',
    input.message,
  ];
  try {
    const output = await git.raw(args); // stdout = 40-char commit SHA + trailing newline
    const commitSha = output.trim();
    return { success: true, commitSha };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

**Key points:**
- `git.raw(args)` uses `execFile` (NOT `sh -c`) — the message is an argv element, safe for newlines (§5.1).
- Argv order: `commit-tree`, treeSha, then `-p parentSha` (if provided), then `-m message`. This matches
  `git commit-tree <tree> [-p <parent>] -m <msg>` syntax.
- `parentSha` omitted → no `-p` → git creates a root commit (rootless repo / first commit, §5.1 edge case).
- Output is the 40-char commit SHA + `\n`; `.trim()` removes the newline.
- The commit is DANGLING — `commit-tree` touches no ref. HEAD advance is S3's `gitUpdateRefCAS`.
- The catch EXTRACTS the error message (commit-tree has multiple failure modes: bad tree SHA, bad parent,
  git internal) — more informative than a fixed string. `e instanceof Error` branch needs both Error and
  non-Error rejection tests for 100% branch coverage.

**JSDoc (Mode A):** cite §5.1 step 2: "git commit-tree (-p <parent>) -m <msg> <tree> — create a commit
object from TREE_SHA, PARENT_SHA, and the message. This touches no ref; the commit is dangling until
update-ref." Note: message via `-m` argv element (execFile, not shell — safe for newlines). `parentSha`
optional (omitted for root commits).

### Success Criteria
- [ ] `GitCommitTreeResult` type + `gitCommitTree` exported from `src/tools/git-mcp.ts`.
- [ ] Uses `validateRepositoryPath` + `simpleGit(safePath).raw([argv])` (mirrors gitWriteTree).
- [ ] Returns `{ success: true, commitSha }` with a trimmed 40-char SHA.
- [ ] `parentSha` provided → argv includes `['-p', parentSha]`; omitted → no `-p` (root commit).
- [ ] Multi-line message passed verbatim as the `-m` argv element (no shell split).
- [ ] Returns `{ success: false, error }` with the git error message on failure.
- [ ] JSDoc cites §5.1 step 2.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; git-mcp tests green at 100%.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's landed `gitWriteTree` (verbatim, with line numbers) is the exact
pattern to mirror, the argv ordering is specified, the message-safety rationale is documented, the
test mock setup (`mockGitInstance.raw`) is identified, the per-branch test cases are enumerated, and
the executable validation commands are below.

### Documentation & References

```yaml
# MUST READ — §5.1 commit workflow (step 2 is this function)
- docfile: PRD.md  # or the <selected_prd_content> §5.1 "Commit Workflow Mechanics" step 2
  section: "Commit Workflow Mechanics" step 2 + "Edge cases" (rootless repo)
  why: step 2 defines commit-tree: "create a commit object from TREE_SHA, PARENT_SHA, and the message.
        This also touches no ref; the commit is dangling until step 3." The rootless edge case:
        "PARENT_SHA is empty; commit-tree is called without -p (root commit)."

# MUST READ — S2 design + the message-safety rationale + test plan
- docfile: plan/015_459c7d9be558/P1M1T1S2/research/git-commit-tree-design.md
  section: "2. The message-via-`-m` safety" and "5. The test file" and "6. S2's test cases"
  why: Why -m via execFile argv is safe for newlines (no stdin needed); the mockGitInstance.raw mock
        pattern; the 6 test cases that cover every branch for 100% coverage.

# PATTERN FILE — the only source file edited; S1's gitWriteTree is the template
- file: src/tools/git-mcp.ts
  why: gitWriteTree at L595-633 (the EXACT pattern to mirror: result union + validateRepositoryPath +
        simpleGit.raw([argv]) + trim + catch). validateRepositoryPath at L202. simpleGit imported at L24.
        Append gitCommitTree after gitWriteTree (~L640). Export it in the re-export block (L919 area).
  pattern: "const safePath = await validateRepositoryPath(repoPath); const git = simpleGit(safePath); try { const output = await git.raw([...]); return { success: true, ...: output.trim() }; } catch { return { success: false, error: '...' }; }"
  gotcha: gitCommitTree takes an INPUT OBJECT ({treeSha, message, parentSha?, repoPath?}), NOT positional
        args like gitWriteTree(repoPath?). The contract mandates the object form.

# PATTERN FILE — the test file to extend
- file: tests/unit/tools/git-mcp.test.ts
  why: mockGitInstance (L70) has raw: vi.fn() (L79). Mock via mockGitInstance.raw.mockResolvedValue('<sha>\n')
        (success) or mockGitInstance.raw.mockRejectedValue(new Error('...')) / 'string' (failure). Assert:
        expect(mockGitInstance.raw).toHaveBeenCalledWith(['commit-tree', ...]). S1 did NOT add gitWriteTree
        tests — S2 adds gitCommitTree tests. Error-rejection precedent: gitStatus tests L329 (GitError),
        L342 (Error), L355 (string).
  pattern: "mockGitInstance.raw.mockResolvedValue('<sha>\\n'); const result = await gitCommitTree({...}); expect(result).toEqual({ success: true, commitSha: '<sha>' }); expect(mockGitInstance.raw).toHaveBeenCalledWith([...]);"
  gotcha: Reset mocks between tests (beforeEach or mockClear). The file's top-level beforeEach (if present)
        handles this; otherwise add mockGitInstance.raw.mockClear() in the describe's beforeEach.

# VERIFIED FACTS
- fact: "S1 is LANDED. gitWriteTree at L595-633; GitWriteTreeResult at L601; exported at L919."
- fact: "simpleGit.raw([...]) uses execFile (argv vector, NOT sh -c). A multi-line message as the -m argv
        element is SAFE — execFile doesn't interpret newlines; git commit-tree -m preserves them."
- fact: "mockGitInstance.raw is a vi.fn() (L79). Mock with mockResolvedValue/mockRejectedValue; assert with
        toHaveBeenCalledWith([...argv])."
- fact: "gitWriteTree has NO tests yet (S1's PRP: 'no existing test touches it'). S2 adds gitCommitTree tests."
- fact: "commit-tree creates a DANGLING commit — it does NOT advance HEAD. S3's gitUpdateRefCAS does that."
```

### Current Codebase tree (relevant slice)

```bash
src/tools/git-mcp.ts                 # EDIT — append GitCommitTreeResult + gitCommitTree + JSDoc + re-export
tests/unit/tools/git-mcp.test.ts     # EDIT — append describe('gitCommitTree') block
# gitWriteTree (S1, L595-633) = READ-ONLY. No other files. No smartCommit rewrite (P1.M1.T3).
```

### Desired Codebase tree with files to be added/edited

```bash
src/tools/git-mcp.ts                 # MODIFIED (additive: 1 type + 1 function + JSDoc + re-export)
tests/unit/tools/git-mcp.test.ts     # MODIFIED (additive: 1 describe block)
# No new files. No smartCommit changes (P1.M1.T3). No gitWriteTree changes (S1).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — gitCommitTree takes an INPUT OBJECT { treeSha, message, parentSha?, repoPath? }, NOT
//   positional args. The contract mandates the object form (unlike gitWriteTree's positional repoPath?).

// CRITICAL — use git.raw([...]) (an argv ARRAY), NOT git.raw('commit-tree ...') (a single string that
//   simple-git may split incorrectly). The array form is the argv-vector pattern §5.1 mandates.

// CRITICAL — the message is an argv ELEMENT (the -m value), NOT shell-interpolated. simpleGit.raw uses
//   execFile — newlines in the message are preserved (git -m treats them as the commit body). No stdin
//   needed. Do NOT concatenate the message into a shell string.

// CRITICAL — commit-tree creates a DANGLING commit. It does NOT advance HEAD, does NOT touch any ref.
//   Do NOT add update-ref/head logic here — that's S3's gitUpdateRefCAS.

// GOTCHA — the catch EXTRACTS the error message (e instanceof Error ? e.message : String(e)), unlike
//   gitWriteTree's fixed-message catch. This is because commit-tree has multiple failure modes (bad tree
//   SHA, bad parent SHA). The instanceof branch needs BOTH Error and non-Error rejection tests for 100%
//   branch coverage — both are in the test plan (cases 5+6).

// GOTCHA — argv order: ['commit-tree', treeSha, ...(-p parentSha), '-m', message]. The tree is the first
//   positional; -p and -m follow. When parentSha is undefined, omit -p entirely (root commit).

// GOTCHA — mockGitInstance.raw is a vi.fn() — mock it with mockResolvedValue('<sha>\\n') for success
//   (note the trailing newline to test .trim()) or mockRejectedValue for failure.

// GOTCHA — vitest 100% coverage on src/**/*.ts. The gitCommitTree branches: parentSha ternary (truthy/
//   falsy), success/error, instanceof Error (true/false). All covered by the 6 test cases.

// GOTCHA — export gitCommitTree in the re-export block (L919 area, where GitWriteTreeResult is exported).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT modify gitWriteTree (S1), gitUpdateRefCAS (S3, not yet implemented), or smartCommit
//   (P1.M1.T3). S2 is a self-contained primitive + its tests.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/tools/git-mcp.ts (append after gitWriteTree ~L640)
export type GitCommitTreeResult =
  | { success: true; commitSha: string }
  | { success: false; error: string };

export async function gitCommitTree(input: {
  treeSha: string;
  message: string;
  parentSha?: string;
  repoPath?: string;
}): Promise<GitCommitTreeResult> { /* validateRepositoryPath → simpleGit.raw([argv]) → trim → catch */ }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/git-mcp.ts — add GitCommitTreeResult + gitCommitTree
  - APPEND GitCommitTreeResult (union: success+commitSha | success+error) after GitWriteTreeResult (~L605).
  - APPEND gitCommitTree(input) after gitWriteTree (~L640). Use validateRepositoryPath(input.repoPath) +
        simpleGit(safePath).raw(args) where args = ['commit-tree', input.treeSha,
        ...(input.parentSha ? ['-p', input.parentSha] : []), '-m', input.message]. Trim output → commitSha.
        Catch (e) → { success: false, error: e instanceof Error ? e.message : String(e) }.
  - ADD JSDoc citing §5.1 step 2 + the no-shell/message-safety note + parentSha-optional note.
  - EXPORT gitCommitTree + GitCommitTreeResult in the re-export block (L919 area).
  - DO NOT modify gitWriteTree or any existing function.
  - EXPECTED: typecheck clean.

Task 2: EDIT tests/unit/tools/git-mcp.test.ts — append describe('gitCommitTree')
  - IMPORT gitCommitTree + GitCommitTreeResult from the module (add to the existing import block).
  - APPEND a describe('gitCommitTree', () => { ... }) block. Use the existing mockGitInstance.raw pattern.
  - CASES (cover every branch for 100% coverage):
      1. SUCCESS WITH PARENT: raw.mockResolvedValue('abc123\\n'); gitCommitTree({ treeSha: 'tree1',
         message: 'msg', parentSha: 'parent1' }); → { success: true, commitSha: 'abc123' }; assert raw
         called with ['commit-tree', 'tree1', '-p', 'parent1', '-m', 'msg'].
      2. SUCCESS WITHOUT PARENT (rootless): raw.mockResolvedValue('def456\\n'); gitCommitTree({ treeSha:
         'tree1', message: 'msg' }); → { success: true, commitSha: 'def456' }; assert raw called with
         ['commit-tree', 'tree1', '-m', 'msg'] (NO -p).
      3. MULTI-LINE MESSAGE: message: 'line1\\nline2'; assert raw called with [..., '-m', 'line1\\nline2']
         (the embedded newline is in the argv element verbatim — no shell split).
      4. TRIM: raw.mockResolvedValue('  sha123  \\n'); → commitSha === 'sha123' (trimmed; not '  sha123  \\n').
      5. FAILURE (Error): raw.mockRejectedValue(new Error('fatal: not a valid object name')); →
         { success: false, error: 'fatal: not a valid object name' }.
      6. FAILURE (non-Error): raw.mockRejectedValue('string error'); → { success: false, error: 'string error' }.
  - RESET raw mock between cases (mockGitInstance.raw.mockClear() in beforeEach, or per-case).
  - NAMING: it('creates a commit with a parent'), it('creates a root commit (no parent)'), it('passes a
        multi-line message verbatim via -m'), it('trims the commit SHA'), it('returns the error message on
        failure (Error)'), it('returns String(e) on failure (non-Error)').
  - PLACEMENT: append the describe block (after the existing gitWriteTree tests, if any, or at the end).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/tools/git-mcp.test.ts --coverage.
  - EXPECTED: clean; git-mcp.ts at 100% coverage on the new lines; existing tests green. If a branch is
        uncovered (e.g. the non-Error catch path, the no-parent path), add the matching case.
```

### Implementation Patterns & Key Details

```ts
// ---- src/tools/git-mcp.ts: gitCommitTree (mirrors gitWriteTree + input object + -p flag) ----
export async function gitCommitTree(input: {
  treeSha: string;
  message: string;
  parentSha?: string;
  repoPath?: string;
}): Promise<GitCommitTreeResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'commit-tree',
    input.treeSha,
    ...(input.parentSha ? ['-p', input.parentSha] : []),   // omitted for root commits (rootless repo)
    '-m',
    input.message,                                          // argv element — execFile preserves newlines
  ];
  try {
    const output = await git.raw(args);
    const commitSha = output.trim();                        // stdout = 40-char SHA + trailing newline
    return { success: true, commitSha };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- tests/unit/tools/git-mcp.test.ts: the mock pattern ----
it('creates a commit with a parent', async () => {
  mockGitInstance.raw.mockResolvedValue('abc123\n');
  const result = await gitCommitTree({ treeSha: 'tree1', message: 'msg', parentSha: 'parent1' });
  expect(result).toEqual({ success: true, commitSha: 'abc123' });
  expect(mockGitInstance.raw).toHaveBeenCalledWith(['commit-tree', 'tree1', '-p', 'parent1', '-m', 'msg']);
});

it('creates a root commit (no parent)', async () => {
  mockGitInstance.raw.mockResolvedValue('def456\n');
  const result = await gitCommitTree({ treeSha: 'tree1', message: 'msg' });
  expect(result.success).toBe(true);
  expect(mockGitInstance.raw).toHaveBeenCalledWith(['commit-tree', 'tree1', '-m', 'msg']);   // NO -p
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T1.S3 (gitUpdateRefCAS): the CAS update-ref that advances HEAD to the dangling commit S2 created.
  - P1.M1.T3.S2 (smartCommit rewrite post-generation): chains gitWriteTree → gitCommitTree → gitUpdateRefCAS
        into the snapshot-based atomic commit.

NO REFS TOUCHED: commit-tree creates a DANGLING commit. It does NOT advance HEAD or touch any ref. S3's
  gitUpdateRefCAS is the only step that moves HEAD (atomically, via CAS). This decoupling is what makes
  the §5.1 commit atomic.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. An additive function + type cannot introduce type errors.
```

### Level 2: Unit Tests (the primitive + 100% coverage)

```bash
npx vitest run tests/unit/tools/git-mcp.test.ts --coverage
# Expected: green; git-mcp.ts at 100% coverage on the new lines (all 6 cases hit every branch:
# parent/no-parent, success/error, Error/non-Error, trim). Existing tests green (additive change).
# If a branch is uncovered, add the matching case (e.g. non-Error rejection for the instanceof branch).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — a self-contained primitive with no caller yet (P1.M1.T3 wires it). Smoke-confirm the
# function creates a dangling commit against a real tmpdir git repo:
npx tsx -e "
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { gitWriteTree, gitCommitTree } from './src/tools/git-mcp.ts';
const t = mkdtempSync(join(tmpdir(),'ct-')); const g = simpleGit(t);
await g.init(); await g.addConfig('user.email','t@t'); await g.addConfig('user.name','t');
await g.checkoutLocalBranch('main');
// write a file, stage it, write-tree, commit-tree (root, no parent), verify dangling commit exists
import { writeFileSync } from 'node:fs'; writeFileSync(join(t,'f.txt'),'hi'); await g.add('f.txt');
const tree = await gitWriteTree(t); console.log('tree:', tree);
const commit = await gitCommitTree({ treeSha: tree.treeSha!, message: 'root commit', repoPath: t });
console.log('commit:', commit);
const cat = await g.raw(['cat-file', '-t', (commit as any).commitSha]); console.log('object type:', cat.trim());
rmSync(t,{recursive:true,force:true});
"
# Expected: tree: { success: true, treeSha: '...' } | commit: { success: true, commitSha: '...' } |
#   object type: commit  (a dangling commit object exists; HEAD is NOT advanced — that's S3's job).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a git-plumbing primitive with no creative surface. Domain checks (record in commit msg):
#   - commit-tree creates a DANGLING commit (no ref mutation — HEAD unchanged).
#   - Message via -m argv element (execFile, not shell — safe for multi-line).
#   - parentSha optional (root commit when omitted — rootless repo edge case).
#   - Mirrors gitWriteTree's pattern (result union + validateRepositoryPath + simpleGit.raw([argv]) + trim).
#   - No consumer wired yet (S3 + P1.M1.T3 chain it).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` green at 100% coverage on new lines.

### Feature Validation
- [ ] `GitCommitTreeResult` + `gitCommitTree` exported.
- [ ] Uses `validateRepositoryPath` + `simpleGit(safePath).raw([argv])`.
- [ ] Returns trimmed commit SHA on success; structured error on failure.
- [ ] `parentSha` provided → `-p` in argv; omitted → no `-p` (root commit).
- [ ] Multi-line message passed verbatim as `-m` argv element.
- [ ] JSDoc cites §5.1 step 2.

### Code Quality Validation
- [ ] Only `src/tools/git-mcp.ts` (additive) + `tests/unit/tools/git-mcp.test.ts` (additive) modified.
- [ ] `gitWriteTree` (S1) UNCHANGED. No ref mutation (dangling commit only). No smartCommit changes (P1.M1.T3).
- [ ] Mirrors S1's pattern (result union + validateRepositoryPath + raw([argv]) + trim).
- [ ] Input is an OBJECT `{ treeSha, message, parentSha?, repoPath? }` (per contract).

### Documentation & Deployment
- [ ] JSDoc on `gitCommitTree` (Mode A — cites §5.1 step 2 + message-safety + parentSha-optional).
- [ ] Commit message notes: step-2 plumbing primitive; mirrors gitWriteTree; dangling commit (no ref); S3 = CAS update-ref.

---

## Anti-Patterns to Avoid

- ❌ Don't use positional args — the contract mandates an INPUT OBJECT `{ treeSha, message, parentSha?, repoPath? }`.
- ❌ Don't use `git.raw('commit-tree ...')` (string) — use `git.raw([...])` (argv array, §5.1).
- ❌ Don't shell-interpolate the message — it's an argv element (execFile preserves newlines). No `sh -c`.
- ❌ Don't advance HEAD or touch any ref — commit-tree creates a DANGLING commit. S3's gitUpdateRefCAS moves HEAD.
- ❌ Don't modify `gitWriteTree` (S1) or any existing function — S2 is purely additive.
- ❌ Don't use a fixed error message in the catch — commit-tree has multiple failure modes; extract
      `(e as Error).message` (with the instanceof branch for non-Error coverage).
- ❌ Don't forget `.trim()` — raw output has a trailing newline.
- ❌ Don't forget to export `gitCommitTree` + `GitCommitTreeResult` in the re-export block (L919 area).
- ❌ Don't skip the non-Error rejection test (case 6) — it's needed for 100% branch coverage on the
      `instanceof Error` catch path.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted git-mcp.test.ts.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: S1 (`gitWriteTree`) is LANDED with the exact pattern to mirror (result union +
validateRepositoryPath + simpleGit.raw([argv]) + trim + catch), verified at L595-633 with line numbers.
S2's only deltas are: (a) an input object instead of positional args, (b) the `-p` flag ternary, (c)
the error-message extraction in the catch. The argv ordering is the standard git commit-tree syntax;
the message-safety (execFile, not shell) is verified. The test mock (`mockGitInstance.raw`) is
identified, and the 6 test cases cover every branch (parent/no-parent, success/error, Error/non-Error,
trim) for 100% coverage. The one subtlety — the `instanceof Error` catch branch needing both Error and
non-Error rejection tests — is explicitly in the test plan with precedent from the existing gitStatus
error tests (L329/L355). No external/runtime unknowns.