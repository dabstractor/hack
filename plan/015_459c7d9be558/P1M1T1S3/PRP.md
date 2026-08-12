# PRP — P1.M1.T1.S3: `gitUpdateRefCAS` — atomic compare-and-swap HEAD advance

> The 3rd and final git plumbing primitive for the §5.1 snapshot-based atomic commit workflow (step 3
> of 3). S1 (LANDED) added `gitWriteTree` (freeze index → TREE_SHA); S2 (CONTRACT, parallel) adds
> `gitCommitTree` (create a DANGLING commit from TREE_SHA + PARENT + message); **S3 adds
> `gitUpdateRefCAS`** — the CAS `update-ref` that atomically advances HEAD to the dangling commit ONLY
> if its current value still equals the expected-old SHA. This is the commit's point-of-no-return — the
> ONLY step that moves HEAD — and it MUST refuse (never force) if HEAD moved. Consumed by P1.M1.T3.S2
> (the smartCommit rewrite's post-generation commit step).

---

## Goal

**Feature Goal**: Add an exported `gitUpdateRefCAS(input)` function to `src/tools/git-mcp.ts` that runs
`git update-ref HEAD <new> [<expected-old>]` via `simpleGit.raw([argv])` — the compare-and-swap form.
On success it returns `{ success: true }` (HEAD atomically advanced). On ANY failure (HEAD moved during
generation, bad SHA, git error → git exits non-zero) it returns `{ success: false, error, casFailure: true }`
— HEAD is left **unchanged** and the caller MUST NOT force the advance (§5.1).

**Deliverable**:
1. **`src/tools/git-mcp.ts`** — `GitUpdateRefCASResult` type + `gitUpdateRefCAS` async function + JSDoc,
   re-exported in the L912/L920 blocks alongside S1/S2's symbols.
2. **`tests/unit/tools/git-mcp.test.ts`** — a `describe('gitUpdateRefCAS', …)` block covering
   success-with-expected-old, success-without-expected-old (rootless), CAS-failure (Error), and
   non-Error failure paths (100% branch coverage).

**Success Definition**:
- `gitUpdateRefCAS({ newSha, expectedOldSha })` returns `{ success: true }`; `raw` called with
  `['update-ref', 'HEAD', newSha, expectedOldSha]` (the expected-old is a BARE POSITIONAL appended,
  not a flag).
- Without `expectedOldSha` (rootless repo / first commit), `raw` called with `['update-ref', 'HEAD', newSha]`
  (no expected-old — §5.1 rootless edge case).
- On failure (raw rejects), returns `{ success: false, error, casFailure: true }` with the git error
  message; HEAD is NOT advanced; the function NEVER forces (`--force` / a retry without the expected-old).
- Uses `validateRepositoryPath` + `simpleGit(safePath).raw([argv])` — mirrors S1's `gitWriteTree` / S2's
  `gitCommitTree` pattern. Built as an argv vector (execFile, NOT `sh -c` — §5.1 no-shell rule).
- `npm run typecheck && npm run lint && npm run format:check` clean; `git-mcp.test.ts` green at 100%
  coverage on the new lines.

---

## Why

- **Closes the §5.1 atomic-commit workflow (step 3).** The snapshot-based pipeline is `write-tree` →
  `commit-tree` → CAS `update-ref`. S1 freezes the index (pure); S2 creates a dangling commit (no ref);
  **S3 is the only step that moves HEAD.** The CAS form `git update-ref HEAD <new> <expected-old>`
  advances HEAD atomically ONLY if its current value equals the expected-old (captured before message
  generation). This is the guarantee that makes the whole commit atomic.
- **NEVER force — the critical safety property.** Message generation takes seconds-to-minutes; a
  concurrent commit can move HEAD in that window. The CAS detects it (git refuses, non-zero exit) and S3
  reports `{ casFailure: true }` so the caller (P1.M1.T3.S2) surfaces a manual-recovery recipe instead
  of clobbering the concurrent commit. Forcing (`--force` / re-running without the expected-old) would
  silently overwrite history — the exact failure mode §5.1's plumbing commit exists to prevent.
- **Pure failure semantics.** A failed/slow/misbehaving update-ref leaves HEAD byte-for-byte unchanged
  (modulo harmless dangling objects from S1/S2 that `git gc` reaps). S3's `{ success: false, casFailure:
  true }` is the single, unambiguous "do not force" signal the caller keys on.
- **Scope discipline.** S3 = `gitUpdateRefCAS` ONLY. S1 = `gitWriteTree` (landed); S2 = `gitCommitTree`
  (parallel); P1.M1.T3 = the smartCommit rewrite that chains all three. S3 is a self-contained primitive.

---

## What

### User-visible behavior
None directly (an internal git-plumbing primitive). Indirectly, once P1.M1.T3.S2 wires it: a pipeline
commit is atomically HEAD-advanced only when no concurrent commit raced it; otherwise the staged work
(TREE_SHA) + generated message are preserved and a manual-recovery recipe is surfaced — history is
never silently clobbered.

### Technical requirements (exact contract)

**File:** `src/tools/git-mcp.ts`. Append after `gitCommitTree` (S2, ~L660 — treat S2 as LANDED) or near
the other raw-plumbing functions, and re-export in the L912/L920 blocks.

**Result type + function:**
```ts
export type GitUpdateRefCASResult =
  | { success: true }
  | { success: false; error: string; casFailure: true };

export async function gitUpdateRefCAS(input: {
  newSha: string;
  expectedOldSha?: string;
  repoPath?: string;
}): Promise<GitUpdateRefCASResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'update-ref',
    'HEAD',
    input.newSha,
    ...(input.expectedOldSha ? [input.expectedOldSha] : []),
  ];
  try {
    await git.raw(args); // update-ref is SILENT on success (exit 0, empty stdout) — HEAD advanced
    return { success: true };
  } catch (e) {
    // update-ref refused (HEAD moved during generation, bad SHA, git error). HEAD is UNCHANGED.
    // NEVER force — the caller surfaces a manual-recovery recipe (§5.1 "HEAD moved during generation").
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      casFailure: true, // the atomic advance did NOT happen
    };
  }
}
```

**Key points:**
- **Input object form** (mirrors S2): `{ newSha, expectedOldSha?, repoPath? }` — NOT positional args.
- **Argv:** `['update-ref', 'HEAD', newSha, ...expectedOldSha]`. The expected-old is a **BARE POSITIONAL**
  appended after `newSha` (per `git update-ref HEAD <new> <expected-old>` syntax — contrast S2's `['-p',
  parent]` flag form). When `expectedOldSha` is undefined, it's omitted entirely (rootless repo / first
  commit — §5.1 edge case).
- **`simpleGit.raw([...])` uses `execFile`** (argv vector, NOT `sh -c`) — satisfies §5.1's no-shell rule
  (system_context.md §2.2 L62-63, verified).
- **Success is silent:** `update-ref` prints nothing to stdout on success (exit 0). `await git.raw(args)`
  resolves to `''`; return `{ success: true }`. No SHA to trim/return (contrast S1/S2 which trim a SHA).
- **`casFailure: true`** on EVERY failure. It means "the atomic HEAD advance did NOT happen" — true for
  the canonical CAS mismatch (HEAD moved; git stderr names `ref is at <actual> but expected <expected>`),
  a bad `newSha`, or any git error. In all cases HEAD is unchanged and the caller MUST NOT force. S3 does
  NOT parse git's stderr wording (fragile across versions); it returns the git message verbatim in `error`
  — the same extract-the-message approach S2 uses.
- **NEVER force:** no `--force`, no retry-without-expected-old, no fallback `git commit`. A `{ success:
  false, casFailure: true }` is terminal for this attempt.

**JSDoc (Mode A):** cite §5.1 step 3 verbatim: *"git update-ref HEAD <new-sha> <expected-old-sha> — the
CAS (compare-and-swap) form atomically advances HEAD only if its current value still equals
[PARENT_SHA]. If HEAD moved (a concurrent commit), the update refuses."* Note: `expectedOldSha` optional
(omitted for rootless repos / first commit — no old HEAD to compare). State the NEVER-force invariant and
that HEAD is byte-for-byte unchanged on any failure.

### Success Criteria
- [ ] `GitUpdateRefCASResult` type + `gitUpdateRefCAS` exported from `src/tools/git-mcp.ts` (re-export
      block L912/L920, after S2's `gitCommitTree` entries).
- [ ] Input is the OBJECT `{ newSha, expectedOldSha?, repoPath? }`.
- [ ] `expectedOldSha` provided → argv `['update-ref', 'HEAD', newSha, expectedOldSha]`; omitted →
      `['update-ref', 'HEAD', newSha]` (rootless).
- [ ] Success → `{ success: true }` (no payload); failure → `{ success: false, error, casFailure: true }`.
- [ ] Uses `validateRepositoryPath` + `simpleGit(safePath).raw([argv])`; argv vector (no shell).
- [ ] NEVER forces the update (no `--force` / no fallback).
- [ ] JSDoc cites §5.1 step 3 + the rootless + never-force notes.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; `git-mcp.test.ts` 100% on new lines.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's landed `gitWriteTree` + S2's `gitCommitTree` contract are the exact
pattern to mirror (verbatim, with line numbers), the argv form (bare-positional expected-old, not a
flag) is specified, the `casFailure` semantic (every failure = "advance did not happen; don't force")
is reasoned out, the success-is-silent delta vs S1/S2 is documented, the test mock (`mockGitInstance.raw`)
is identified with its line number, the per-branch test cases are enumerated, and the executable
validation commands are below.

### Documentation & References

```yaml
# MUST READ — §5.1 commit workflow (step 3 is this function) + the "HEAD moved" edge case
- docfile: PRD.md   # or the <selected_prd_content> §5.1 "Commit Workflow Mechanics" step 3 + "Edge cases"
  section: "Commit Workflow Mechanics" step 3 + "Edge cases" (HEAD moved during generation)
  why: step 3 defines the CAS update-ref: "atomically advances HEAD only if its current value still equals
        PARENT_SHA. If HEAD moved (a concurrent commit), the update refuses." The edge case: "the CAS
        update-ref fails; the subsystem MUST NOT force the update … surfaces a manual recovery recipe."
  critical: NEVER force. The rootless edge case ("PARENT_SHA is empty; update-ref HEAD <new> is called
        without the expected-old argument") is S3's expectedOldSha-omitted path.

# MUST READ — the no-shell / execFile fact + the plumbing-gap confirmation
- docfile: plan/015_459c7d9be558/architecture/system_context.md
  section: "§2.2" L62-63 (simpleGit.raw uses execFile, not shell) + L78 (write-tree/commit-tree/update-ref
        CAS entirely absent — the gap S1/S2/S3 fill) + L106 (the 3-step workflow).
  why: Confirms simpleGit.raw([argv]) satisfies §5.1's no-shell rule; update-ref CAS is the step-3 primitive.

# MUST READ — S1's landed pattern (the template) + S2's input-object/instanceof-Error contract
- file: plan/015_459c7d9be558/P1M1T1S1/PRP.md
  why: gitWriteTree (LANDED at L595-633) = the exact result-union + validateRepositoryPath +
        simpleGit.raw([argv]) + catch pattern to mirror. S3's only structural change is the result shape
        ({success:true} | {success:false,error,casFailure:true}) + the bare-positional append.
- file: plan/015_459c7d9be558/P1M1T1S2/PRP.md
  why: gitCommitTree (CONTRACT, parallel) = the input-object form + conditional argv append + the
        `e instanceof Error ? e.message : String(e)` catch. S3 mirrors both; the conditional append is
        `[expectedOldSha]` (bare positional) instead of `['-p', parent]` (flag).

# MUST READ — S3 design + the casFailure semantic + the S1/S2/S3 delta table
- docfile: plan/015_459c7d9be558/P1M1T1S3/research/git-update-ref-cas-design.md
  section: "2. THE casFailure semantic" and "3. The two S3 deltas vs S1/S2" and "4. Re-export"
  why: Why every failure carries casFailure (HEAD-not-advanced, don't force — true for mismatch AND
        bad-SHA); the bare-positional vs -p-flag distinction; the re-export parallel-collision note.

# PATTERN FILE 1 — the only source file edited
- file: src/tools/git-mcp.ts
  why: validateRepositoryPath at L202 (reuse); simpleGit imported at L24; gitWriteTree at L595-633 +
        GitWriteTreeResult at L601 (the template). Append gitUpdateRefCAS after gitCommitTree (S2, ~L660).
        Re-export GitUpdateRefCASResult in the `export type {}` block (L912, after GitCommitTreeResult)
        and gitUpdateRefCAS in the `export {}` block (L920, after gitCommitTree).
  pattern: "const safePath = await validateRepositoryPath(input.repoPath); const git = simpleGit(safePath);
        const args = [...]; try { await git.raw(args); return { success: true }; } catch (e) { return
        { success: false, error: e instanceof Error ? e.message : String(e), casFailure: true }; }"
  gotcha: update-ref is SILENT on success — no stdout to trim. Return { success: true } with no payload
        (contrast S1/S2 which trim+return a SHA). The expected-old is a BARE POSITIONAL, not a -p flag.

# PATTERN FILE 2 — the test file to extend
- file: tests/unit/tools/git-mcp.test.ts
  why: mockGitInstance.raw is a vi.fn() (L79). simpleGit mocked at L28 (`simpleGit: vi.fn(() =>
        mockGitInstance)`). Top-level describe('tools/git-mcp') + beforeEach at L82-83 resets mocks.
        Mock raw with mockResolvedValue('') (success) or mockRejectedValue(...); assert with
        toHaveBeenCalledWith([...argv]). Error-rejection precedent: gitStatus tests.
  pattern: "mockGitInstance.raw.mockResolvedValue(''); const r = await gitUpdateRefCAS({ newSha: 'new1',
        expectedOldSha: 'old1' }); expect(r).toEqual({ success: true });
        expect(mockGitInstance.raw).toHaveBeenCalledWith(['update-ref','HEAD','new1','old1']);"
  gotcha: update-ref prints nothing on success — mock the empty string (''), NOT a SHA. Reset raw between
        cases (the top-level beforeEach at L83 should handle it; otherwise mockGitInstance.raw.mockClear()
        in the describe's own beforeEach).

# VERIFIED FACTS
- fact: "S1 is LANDED (gitWriteTree L595-633; GitWriteTreeResult L601; re-exported L918/L936)."
- fact: "S2 (parallel) adds gitCommitTree (input object + -p append + instanceof catch); S3 mirrors it."
- fact: "simpleGit.raw([...]) uses child_process.execFile (argv vector, NOT sh -c) — §5.1 no-shell rule."
- fact: "git update-ref HEAD <new> [<expected>] is SILENT on success (exit 0, empty stdout); exits non-zero
        and prints to stderr when the CAS fails (HEAD != expected) or the SHA is invalid."
- fact: "mockGitInstance.raw (L79) is a vi.fn(); mockGitInstance is returned by the mocked simpleGit (L28)."
```

### Current Codebase tree (relevant slice)

```bash
src/tools/git-mcp.ts                 # EDIT — append GitUpdateRefCASResult + gitUpdateRefCAS + JSDoc + re-export
tests/unit/tools/git-mcp.test.ts     # EDIT — append describe('gitUpdateRefCAS') block
# gitWriteTree (S1, L595-633) + gitCommitTree (S2, ~L660) = READ-ONLY. No smartCommit (P1.M1.T3).
```

### Desired Codebase tree with files to be edited

```bash
src/tools/git-mcp.ts                 # MODIFIED (additive: 1 type + 1 function + JSDoc + 2 re-export lines)
tests/unit/tools/git-mcp.test.ts     # MODIFIED (additive: 1 describe block)
# No new files. No gitWriteTree/gitCommitTree changes. No smartCommit rewrite (P1.M1.T3).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — gitUpdateRefCAS takes an INPUT OBJECT { newSha, expectedOldSha?, repoPath? }, NOT positional
//   args (mirrors S2's gitCommitTree; contrasts S1's positional repoPath?).

// CRITICAL — the expected-old is a BARE POSITIONAL appended after newSha, NOT a flag. Argv is
//   ['update-ref', 'HEAD', newSha, ...(expectedOldSha ? [expectedOldSha] : [])]. Do NOT use a -p-style
//   flag (that was S2's commit-tree parent). git's syntax is `update-ref <ref> <new> [<old>]`.

// CRITICAL — update-ref is SILENT on success (empty stdout, exit 0). Do NOT try to trim/return a SHA.
//   Return { success: true } with no payload. (S1/S2 trim a SHA from stdout; S3 does not.)

// CRITICAL — EVERY failure returns casFailure: true. It means "the atomic HEAD advance did NOT happen —
//   update-ref refused." True for the CAS mismatch (HEAD moved), a bad newSha, or any git error. Do NOT
//   parse git's stderr wording to distinguish them (fragile across versions) — return the message verbatim
//   in `error`. The caller's "don't force, surface recovery" contract is identical for all failures.

// CRITICAL — NEVER force. No --force, no retry-without-expected-old, no fallback git commit. A
//   { success: false, casFailure: true } is terminal for this attempt (§5.1).

// CRITICAL — use git.raw([...]) (an argv ARRAY), NOT git.raw('update-ref ...') (a single string that
//   simple-git may split incorrectly). The array form is the argv-vector pattern §5.1 mandates.

// GOTCHA — the catch EXTRACTS the error message (e instanceof Error ? e.message : String(e)), like S2.
//   The instanceof branch needs BOTH Error and non-Error rejection tests for 100% branch coverage
//   (cases 3+4 in the test plan).

// GOTCHA — mockGitInstance.raw is a vi.fn() (L79). Mock SUCCESS with mockResolvedValue('') (the empty
//   string — update-ref prints nothing), NOT a SHA. Mock FAILURE with mockRejectedValue.

// GOTCHA — re-export: add GitUpdateRefCASResult to the `export type {}` block (L912, after S2's
//   GitCommitTreeResult) and gitUpdateRefCAS to the `export {}` block (L920, after gitCommitTree). S2
//   (parallel) edits the same block for its symbols — the orchestrator sequences S2 before S3, so append
//   after S2's entries (treat S2 as LANDED). Different symbols → no conflict.

// GOTCHA — vitest 100% coverage on src/**/*.ts. The gitUpdateRefCAS branches: expectedOldSha ternary
//   (truthy/falsy), success/error, instanceof Error (true/false). All covered by the 4 test cases.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — do NOT modify gitWriteTree (S1), gitCommitTree (S2), or smartCommit (P1.M1.T3). S3 is a
//   self-contained primitive + its tests.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/tools/git-mcp.ts (append after gitCommitTree, ~L660)
export type GitUpdateRefCASResult =
  | { success: true }
  | { success: false; error: string; casFailure: true };

export async function gitUpdateRefCAS(input: {
  newSha: string;
  expectedOldSha?: string;
  repoPath?: string;
}): Promise<GitUpdateRefCASResult> { /* validateRepositoryPath → simpleGit.raw([argv]) → {success:true} | catch → {success:false,error,casFailure:true} */ }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/git-mcp.ts — add GitUpdateRefCASResult + gitUpdateRefCAS
  - APPEND GitUpdateRefCASResult (union: {success:true} | {success:false,error,casFailure:true}) after
        GitCommitTreeResult (S2, ~L605; treat S2 as LANDED).
  - APPEND gitUpdateRefCAS(input) after gitCommitTree (~L660). Use validateRepositoryPath(input.repoPath) +
        simpleGit(safePath).raw(args) where args = ['update-ref', 'HEAD', input.newSha,
        ...(input.expectedOldSha ? [input.expectedOldSha] : [])]. On resolve → { success: true } (update-ref
        is silent). Catch (e) → { success: false, error: e instanceof Error ? e.message : String(e),
        casFailure: true }.
  - ADD JSDoc citing §5.1 step 3 verbatim + the rootless (expectedOldSha optional) + NEVER-force notes.
  - RE-EXPORT: add GitUpdateRefCASResult to the `export type {}` block (L912, after GitCommitTreeResult)
        and gitUpdateRefCAS to the `export {}` block (L920, after gitCommitTree).
  - DO NOT modify gitWriteTree (S1), gitCommitTree (S2), or any existing function. NEVER force.
  - EXPECTED: typecheck clean.

Task 2: EDIT tests/unit/tools/git-mcp.test.ts — append describe('gitUpdateRefCAS')
  - IMPORT gitUpdateRefCAS + GitUpdateRefCASResult from the module (add to the existing import block).
  - APPEND a describe('gitUpdateRefCAS', () => { ... }) block (inside the top-level describe). Use the
        existing mockGitInstance.raw pattern.
  - CASES (cover every branch for 100% coverage):
      1. SUCCESS WITH expectedOldSha: raw.mockResolvedValue(''); gitUpdateRefCAS({ newSha: 'new1',
         expectedOldSha: 'old1' }); → { success: true }; assert raw called with
         ['update-ref', 'HEAD', 'new1', 'old1'].
      2. SUCCESS WITHOUT expectedOldSha (rootless): raw.mockResolvedValue(''); gitUpdateRefCAS({ newSha:
         'new1' }); → { success: true }; assert raw called with ['update-ref', 'HEAD', 'new1'] (NO old sha).
      3. CAS FAILURE (Error): raw.mockRejectedValue(new Error('! 0000: expected old1 but found actual1'));
         → { success: false, casFailure: true, error: '! 0000: expected old1 but found actual1' }.
      4. FAILURE (non-Error): raw.mockRejectedValue('string error'); → { success: false, casFailure: true,
         error: 'string error' } (covers the instanceof Error FALSE branch).
  - RESET raw between cases (the top-level beforeEach at L83 handles it; otherwise add
        mockGitInstance.raw.mockClear() in the describe's beforeEach).
  - NAMING: it('atomically advances HEAD with the expected-old SHA'), it('advances HEAD without
        expected-old (rootless repo)'), it('reports casFailure when HEAD moved (Error)'), it('reports
        casFailure with String(e) on a non-Error rejection').
  - PLACEMENT: append the describe block (after S2's gitCommitTree tests, or at the end).

Task 3: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/tools/git-mcp.test.ts --coverage.
  - EXPECTED: clean; git-mcp.ts at 100% coverage on the new lines (all 4 cases hit every branch:
        expected-old/no-expected-old, success/error, Error/non-Error). Existing tests green (additive).
        If a branch is uncovered, add the matching case.
```

### Implementation Patterns & Key Details

```ts
// ---- src/tools/git-mcp.ts: gitUpdateRefCAS (mirrors S2's input-object + conditional append; bare positional) ----
export async function gitUpdateRefCAS(input: {
  newSha: string;
  expectedOldSha?: string;
  repoPath?: string;
}): Promise<GitUpdateRefCASResult> {
  const safePath = await validateRepositoryPath(input.repoPath);
  const git = simpleGit(safePath);
  const args = [
    'update-ref',
    'HEAD',
    input.newSha,
    ...(input.expectedOldSha ? [input.expectedOldSha] : []), // BARE POSITIONAL — omitted for rootless repos
  ];
  try {
    await git.raw(args); // SILENT on success (exit 0, empty stdout) — HEAD atomically advanced
    return { success: true };
  } catch (e) {
    // update-ref refused (HEAD moved during generation, bad SHA, git error). HEAD is UNCHANGED.
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      casFailure: true, // the atomic advance did NOT happen — NEVER force
    };
  }
}

// ---- tests/unit/tools/git-mcp.test.ts: the mock pattern ----
it('atomically advances HEAD with the expected-old SHA', async () => {
  mockGitInstance.raw.mockResolvedValue(''); // update-ref is silent on success
  const result = await gitUpdateRefCAS({ newSha: 'new1', expectedOldSha: 'old1' });
  expect(result).toEqual({ success: true });
  expect(mockGitInstance.raw).toHaveBeenCalledWith(['update-ref', 'HEAD', 'new1', 'old1']);
});

it('advances HEAD without expected-old (rootless repo)', async () => {
  mockGitInstance.raw.mockResolvedValue('');
  const result = await gitUpdateRefCAS({ newSha: 'new1' });
  expect(result).toEqual({ success: true });
  expect(mockGitInstance.raw).toHaveBeenCalledWith(['update-ref', 'HEAD', 'new1']); // NO old sha
});

it('reports casFailure when HEAD moved (Error)', async () => {
  mockGitInstance.raw.mockRejectedValue(new Error('! 0000000000000000000000000000000000000000: expected old1 but found actual1'));
  const result = await gitUpdateRefCAS({ newSha: 'new1', expectedOldSha: 'old1' });
  expect(result).toEqual({
    success: false,
    casFailure: true,
    error: '! 0000000000000000000000000000000000000000: expected old1 but found actual1',
  });
});
```

### Integration Points

```yaml
DOWNSTREAM (S3 ENABLES these — separate subtasks, do NOT do them here):
  - P1.M1.T3.S2 (smartCommit rewrite post-generation): chains gitWriteTree (S1) → gitCommitTree (S2) →
        gitUpdateRefCAS (S3) into the snapshot-based atomic commit. On { success: false, casFailure: true },
        it surfaces the generated message + the manual recovery recipe (`git commit-tree -p <PARENT_SHA>
        -m "<msg>" <TREE_SHA> | xargs git update-ref HEAD`) and exits non-zero — it NEVER forces.

NO REFS TOUCHED ON FAILURE: update-ref is atomic — on { success: false } HEAD is byte-for-byte unchanged
  (the TREE_SHA + dangling commit from S1/S2 remain, reaped later by git gc). S3 is the ONLY step that
  moves HEAD; it does so atomically (CAS) or not at all.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. An additive function + type cannot introduce type errors. If lint flags an unused
#   import, confirm you re-exported gitUpdateRefCAS + GitUpdateRefCASResult in BOTH export blocks.
```

### Level 2: Unit Tests (the primitive + 100% coverage)

```bash
npx vitest run tests/unit/tools/git-mcp.test.ts --coverage
# Expected: green; git-mcp.ts at 100% coverage on the new lines (all 4 cases hit every branch:
# expected-old/no-expected-old, success/error, Error/non-Error). Existing tests green (additive).
# If a branch is uncovered, add the matching case (e.g. the non-Error rejection for the instanceof branch).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S3 — a self-contained primitive with no caller yet (P1.M1.T3 wires it). Smoke-confirm the CAS
# semantics against a real tmpdir git repo (success advances HEAD; a wrong expected-old refuses):
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { gitWriteTree, gitCommitTree, gitUpdateRefCAS } from './src/tools/git-mcp.ts';
const t = mkdtempSync(join(tmpdir(),'cas-')); const g = simpleGit(t);
await g.init(); await g.addConfig('user.email','t@t'); await g.addConfig('user.name','t');
await g.checkoutLocalBranch('main'); writeFileSync(join(t,'f.txt'),'hi'); await g.add('f.txt');
const parent = (await g.raw(['write-tree'])).trim();
// (use commit-tree to make a real commit object from the tree, then CAS-advance HEAD to it)
const tree = await gitWriteTree(t);
const commit = await gitCommitTree({ treeSha: tree.treeSha!, message: 'root', repoPath: t });
const ok = await gitUpdateRefCAS({ newSha: commit.commitSha!, repoPath: t });       // rootless: no expected-old
console.log('rootless advance:', ok);
// now move HEAD, then attempt a CAS with a STALE expected-old → must refuse (casFailure)
await g.raw(['rev-parse','HEAD']).then(async r => { /* HEAD is now commit */ });
const stale = '0'.repeat(40);
const refused = await gitUpdateRefCAS({ newSha: commit.commitSha!, expectedOldSha: stale, repoPath: t });
console.log('stale CAS:', refused);
rmSync(t,{recursive:true,force:true});
"
# Expected: rootless advance: { success: true } | stale CAS: { success: false, casFailure: true, error: '...' }
#   (HEAD was NOT clobbered — the stale expected-old didn't match).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — a git-plumbing primitive with no creative surface. Domain checks (record in commit msg):
#   - update-ref CAS atomically advances HEAD ONLY when current == expected-old (the §5.1 invariant).
#   - NEVER forces: { success: false, casFailure: true } is terminal; HEAD byte-for-byte unchanged.
#   - expectedOldSha optional (rootless repo / first commit — bare `update-ref HEAD <new>`).
#   - Bare-positional argv (not a -p flag); execFile (no shell); silent on success.
#   - Mirrors S1/S2's pattern; the ONLY step that moves HEAD. No consumer wired yet (P1.M1.T3.S2 chains it).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/tools/git-mcp.test.ts` green at 100% coverage on new lines.

### Feature Validation
- [ ] `GitUpdateRefCASResult` + `gitUpdateRefCAS` exported (both re-export blocks).
- [ ] Input object `{ newSha, expectedOldSha?, repoPath? }`.
- [ ] `expectedOldSha` provided → argv includes it (bare positional); omitted → not present (rootless).
- [ ] Success → `{ success: true }` (no payload); failure → `{ success: false, error, casFailure: true }`.
- [ ] Uses `validateRepositoryPath` + `simpleGit.raw([argv])` (no shell); NEVER forces.
- [ ] JSDoc cites §5.1 step 3 + rootless + never-force.

### Code Quality Validation
- [ ] Only `src/tools/git-mcp.ts` (additive) + `tests/unit/tools/git-mcp.test.ts` (additive) modified.
- [ ] `gitWriteTree` (S1) + `gitCommitTree` (S2) UNCHANGED. No smartCommit changes (P1.M1.T3).
- [ ] Mirrors S1/S2's pattern (result union + validateRepositoryPath + raw([argv]) + instanceof catch).
- [ ] `casFailure: true` on EVERY failure (the atomic-advance-did-not-happen signal; no stderr-word parsing).
- [ ] Re-export lines added to BOTH export blocks (after S2's gitCommitTree entries).

### Documentation & Deployment
- [ ] JSDoc on `gitUpdateRefCAS` (Mode A — cites §5.1 step 3 verbatim + rootless + never-force).
- [ ] Commit message notes: step-3 plumbing primitive; the ONLY step that moves HEAD (atomically, via CAS);
      never forces; S1=write-tree, S2=commit-tree; P1.M1.T3.S2 chains all three.

---

## Anti-Patterns to Avoid

- ❌ Don't use positional args — the contract mandates an INPUT OBJECT `{ newSha, expectedOldSha?, repoPath? }`.
- ❌ Don't use a `-p`-style flag for the expected-old — it's a BARE POSITIONAL (`['update-ref','HEAD',new,
      old]`), per `git update-ref <ref> <new> [<old>]` syntax. (The `-p` flag was S2's commit-tree parent.)
- ❌ Don't trim/return a SHA on success — `update-ref` is SILENT (empty stdout). Return `{ success: true }`.
- ❌ Don't parse git's stderr wording to distinguish "CAS mismatch" from "bad SHA" — fragile across
      versions. Return the message verbatim; label EVERY failure `casFailure: true` (HEAD-not-advanced).
- ❌ Don't EVER force — no `--force`, no retry-without-expected-old, no fallback `git commit`. A
      `{ success: false, casFailure: true }` is terminal (§5.1 "MUST NOT force the update").
- ❌ Don't use `git.raw('update-ref ...')` (string) — use `git.raw([...])` (argv array, §5.1 no-shell rule).
- ❌ Don't modify `gitWriteTree` (S1), `gitCommitTree` (S2), or `smartCommit` (P1.M1.T3) — S3 is purely additive.
- ❌ Don't forget the non-Error rejection test (case 4) — it's needed for 100% branch coverage on the
      `instanceof Error` catch path.
- ❌ Don't forget to re-export `gitUpdateRefCAS` + `GitUpdateRefCASResult` in BOTH the `export type {}`
      (L912) and `export {}` (L920) blocks.
- ❌ Don't mock success with a SHA — `update-ref` prints nothing; mock `mockResolvedValue('')`.
- ❌ Don't run the full `npm run test:run` as the gate — use the targeted `git-mcp.test.ts`.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: S1 (`gitWriteTree`) is LANDED with the exact pattern to mirror (result union +
validateRepositoryPath + simpleGit.raw([argv]) + catch), verified at L595-633 with line numbers, and S2
(`gitCommitTree`) is a precise parallel contract for the input-object + conditional-append + instance-of-Error
shape. S3's only deltas are: (a) a bare-positional expected-old instead of a `-p` flag, (b) success is
silent (no SHA to trim — `{ success: true }`), (c) the `{success:false, error, casFailure:true}` failure
shape. The `casFailure` semantic (every failure = "atomic advance did not happen; don't force") is fully
reasoned and matches the §5.1 never-force invariant. The no-shell/execFile fact (system_context.md §2.2)
and the re-export blocks (L912/L920) are verified. The test mock (`mockGitInstance.raw` L79) is identified,
and the 4 test cases cover every branch (expected-old/no-expected-old, success/error, Error/non-Error) for
100% coverage. The one parallel-collision note (S2 + S3 both edit the re-export block) is handled by the
orchestrator's S2-before-S3 sequencing. No external/runtime unknowns.