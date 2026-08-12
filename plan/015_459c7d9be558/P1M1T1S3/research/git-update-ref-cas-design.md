# Design Note — P1.M1.T1.S3: `gitUpdateRefCAS` — atomic compare-and-swap HEAD advance

> The 3rd git plumbing primitive (step 3 of the §5.1 atomic commit). Captures the verified facts +
> the two S3-specific deltas vs S1/S2. Read before implementing.

## 0. What S3 consumes (S1 LANDED; S2 = parallel contract)

- **S1 (LANDED)**: `gitWriteTree` (src/tools/git-mcp.ts L595-633) + `GitWriteTreeResult` (L601),
  re-exported at L918/L936. Established the pattern: result union + `validateRepositoryPath(repoPath)` +
  `simpleGit(safePath).raw([argv])` + `.trim()` + structured catch.
- **S2 (CONTRACT, parallel)**: `gitCommitTree(input)` — INPUT OBJECT form, argv with a conditional
  append (`-p`), catch extracts `e instanceof Error ? e.message : String(e)`, re-exported alongside S1.
- **S3 (this)**: `gitUpdateRefCAS(input)` — the CAS HEAD advance. Mirrors S2's input-object + conditional-
  append + instance-of-Error catch shape; deltas are (a) bare-positional expected-old (not a `-p` flag),
  (b) no SHA to trim (update-ref is silent on success), (c) `{ success: true }` / `{ success: false, error,
  casFailure: true }` result, (d) `casFailure` discriminates the failure branch.

## 1. The exact contract (verified against §5.1 + the item)

INPUT: `{ newSha: string; expectedOldSha?: string; repoPath?: string }` (object form, like S2).
- `expectedOldSha` OPTIONAL → omitted for rootless repos (first commit has no old HEAD to compare).

ARGV: `['update-ref', 'HEAD', input.newSha, ...(input.expectedOldSha ? [input.expectedOldSha] : [])]`.
- `git update-ref HEAD <new> <expected-old>` is the CAS form (§5.1 step 3). The expected-old is a BARE
  POSITIONAL appended after newSha — NOT a `-p`-style flag. (Contrast S2, which appends `['-p', parent]`.)

RESULT:
```ts
export type GitUpdateRefCASResult =
  | { success: true }
  | { success: false; error: string; casFailure: true };
```
- Success → `{ success: true }` (update-ref is SILENT on success — empty stdout; no SHA to trim/return).
- Failure → `{ success: false, error, casFailure: true }`. The `casFailure: true` LITERAL discriminates
  the failure branch.

## 2. THE `casFailure` semantic (why ALL failures carry it)

`casFailure: true` means **"the atomic HEAD advance did NOT happen — update-ref refused."** That is true
for EVERY update-ref failure:
- The canonical CAS mismatch: HEAD moved during generation (git exits non-zero, stderr names
  `ref is at <actual> but expected <expected>` — the item's wording).
- A bad `newSha` / invalid ref / git-internal error — also a refused advance.

In all cases HEAD is unchanged and the caller (P1.M1.T3.S2) MUST NOT force the update (§5.1: "the
subsystem MUST NOT force the update … surfaces the generated message plus a manual recovery recipe").
Labeling every failure `casFailure: true` is semantically sound — it signals "HEAD not advanced, don't
force, surface recovery" — and matches the result type (the failure branch always carries it). S3 does
NOT parse git's stderr wording (fragile across versions); it catches the non-zero exit and returns the
git error message verbatim in `error`. This is the same "extract the message, don't classify by wording"
approach S2 uses.

Even the rootless case (no `expectedOldSha`) returns `casFailure: true` on failure — there's no "compare"
but the advance still didn't happen, and the caller's "don't force" contract is identical.

## 3. The two S3 deltas vs S1/S2 (the whole implementation surface)

| Aspect | S1 gitWriteTree | S2 gitCommitTree | **S3 gitUpdateRefCAS** |
| --- | --- | --- | --- |
| Args | positional `repoPath?` | input object | **input object** `{ newSha, expectedOldSha?, repoPath? }` |
| Conditional append | — | `['-p', parent]` (flag) | **`[expectedOldSha]`** (bare positional) |
| Success payload | `treeSha` (trim stdout) | `commitSha` (trim stdout) | **none** (update-ref silent → `{ success: true }`) |
| Failure payload | fixed message | extracted message | **extracted message + `casFailure: true`** |
| Refs touched | none (pure) | none (dangling commit) | **HEAD** (the ONLY step that moves HEAD — atomically, via CAS) |

S3 is the step that actually advances HEAD — which is why its failure contract ("NEVER force") is the
critical safety property. S1/S2 are pure/dangling; S3 is the commit's atomic point-of-no-return.

## 4. Re-export + parallel-collision note

The re-export block is at L912 (`export type { … }`) and L920 (`export { … }`). S2 (parallel) adds
`GitCommitTreeResult` + `gitCommitTree` there. S3 adds `GitUpdateRefCASResult` + `gitUpdateRefCAS`. They
edit the SAME block but DIFFERENT symbols. The orchestrator sequences S2 (Ready) before S3 (Researching),
so S3 appends after S2's entries — no merge conflict (each adds its own line). Treat S2 as LANDED.

## 5. Test plan (100% coverage; mirrors S2's mock pattern)

`mockGitInstance.raw` is a `vi.fn()` (tests/unit/tools/git-mcp.test.ts L79). Mock with
`mockResolvedValue('')` (success — update-ref prints nothing) or `mockRejectedValue(...)`. Assert
`expect(mockGitInstance.raw).toHaveBeenCalledWith([...argv])`. The top-level `beforeEach` (L83) resets
mocks. Cases (cover every branch):
1. SUCCESS WITH expectedOldSha → `{ success: true }`; raw called with `['update-ref', 'HEAD', 'new1', 'old1']`.
2. SUCCESS WITHOUT expectedOldSha (rootless) → `{ success: true }`; raw called with `['update-ref', 'HEAD', 'new1']` (NO old sha).
3. CAS FAILURE (Error) → `{ success: false, casFailure: true, error: <msg> }`.
4. FAILURE (non-Error rejection) → `{ success: false, casFailure: true, error: 'string error' }` (covers the `instanceof Error` false branch).

Branches covered: expectedOldSha ternary (1+2), success/error (1+3), instanceof Error (3+4). All hit.

## 6. Scope discipline

S3 = `gitUpdateRefCAS` + `GitUpdateRefCASResult` + JSDoc + re-export + its test block ONLY. It does NOT
modify gitWriteTree (S1) or gitCommitTree (S2), and does NOT chain them into smartCommit (P1.M1.T3).
It is the final self-contained plumbing primitive; P1.M1.T3.S2 wires all three into the snapshot-based
atomic commit.