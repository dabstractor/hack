# PRP — P1.M1.T3.S1: Pre-generation snapshot — capture PARENT_SHA, write-tree → TREE_SHA, identity transparency

> Plan 015, PRD §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" + §9.10
> "Commit Generation & Agent Tool Safety." This is the **pre-generation step** of the 3-subtask
> `smartCommit` plumbing rewrite (S1 pre-gen → S2 post-gen commit-tree+CAS → S3 rescue). **S1 captures
> `PARENT_SHA` (`git rev-parse HEAD`, rootless → undefined), freezes the staged index via `gitWriteTree`
> → `TREE_SHA`, and aborts BEFORE message generation on unresolved merge conflicts** — with commit-identity
> transparency. The captured values flow to S2; the existing message-gen + `gitCommit` path stays intact
> for this subtask. Architecture: `plan/015_459c7d9be558/architecture/system_context.md §2.1`.

---

## Goal

**Feature Goal**: Insert the pre-generation snapshot capture into `smartCommit` (`src/utils/git-commit.ts`):
after staging + `restore_critical_files`, capture `PARENT_SHA` (current HEAD via a new `gitRevParseHead`
plumbing wrapper; rootless repo → `undefined`) and freeze the staged index into `TREE_SHA` via the
existing `gitWriteTree`. On `gitWriteTree` failure (unresolved merge conflicts), **abort BEFORE message
generation** — log + `return null` per the never-fail contract (fail-fast: never spend an LLM call on an
uncommittable index). Enforce commit-identity transparency (no `user.*` config, no `GIT_AUTHOR_*` /
`GIT_COMMITTER_*` env on any git subprocess). The existing message-generation + `gitCommit` path is
UNCHANGED (S2 replaces `gitCommit` with commit-tree + CAS update-ref; S3 adds the rescue path). Update
the `smartCommit` JSDoc to cite §5.1 snapshot-based atomic commit + identity transparency.

**Deliverable**:
1. **`src/tools/git-mcp.ts`** — NEW `gitRevParseHead(repoPath?)` plumbing wrapper (mirrors `gitWriteTree`:
   `simpleGit.raw(['rev-parse','HEAD'])`, structured `{success,sha}|{success,error}`, rootless-safe) + its
   `GitRevParseHeadResult` type + re-export via the existing `export { … }` block.
2. **`src/utils/git-commit.ts`** — (a) import `gitWriteTree` + `gitRevParseHead`; (b) insert the
   pre-generation capture block after `await restore_critical_files(repoRoot);` (L652) and before the
   message-resolution block (L654); (c) update the `smartCommit` JSDoc (Mode A).
3. **`tests/unit/utils/git-commit.test.ts`** — (a) add `gitWriteTree` + `gitRevParseHead` to the mock
   factory + import; (b) add their **shared `beforeEach` defaults** (every existing smartCommit test
   needs them or it breaks); (c) add ONE new test proving the write-tree-conflict fail-fast (returns
   null, never reaches `generateCommitMessage`/`gitCommit`).

**Success Definition**:
- `smartCommit`, after staging + restore, calls `gitRevParseHead(repoRoot)` → `parentSha` (or `undefined`
  for a rootless repo), then `gitWriteTree(repoRoot)` → `treeSha`.
- On `gitWriteTree` returning `{success:false}` (merge conflicts), `smartCommit` logs + returns `null`
  **without** calling `generateCommitMessage` or `gitCommit` (the fail-fast).
- The existing message-generation + `gitCommit` path is byte-unchanged; `gitCommit` still runs (S2
  replaces it). `parentSha` + `treeSha` are captured (debug-logged) and flow forward to S2.
- Commit-identity transparency holds: no `user.name`/`user.email`, no `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
  env on any git subprocess in this path (the plumbing wrappers inherit repo config only).
- `smartCommit`'s signature + return type are UNCHANGED.
- `npm run test:run -- git-commit` GREEN (new fail-fast test + all existing smartCommit tests GREEN with
  the new mock defaults); `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

## User Persona

N/A — internal commit-subsystem integration. Indirect "users" are the pipeline's survival/recovery
commits (every work-item pre/post-cleanup commit): the pre-generation snapshot is what makes the eventual
S2 CAS-advance atomic (HEAD never moves unless the snapshot matches), and the conflict fail-fast avoids
wasting an LLM call on an uncommittable index.

## Why

- **Implements §5.1 "Commit Workflow Mechanics" step 1 (pre-generation).** The snapshot-based atomic
  commit captures PARENT_SHA + freezes the index into TREE_SHA BEFORE the slow message-generation step.
  This is the foundation S2's `commit-tree` + CAS `update-ref` build on (the CAS compares HEAD against
  the captured PARENT_SHA).
- **Fail-fast on merge conflicts (a real improvement, live in S1).** Today a conflicted index reaches
  `gitCommit` late (after the LLM call) and fails there. S1's `gitWriteTree` detects the conflict BEFORE
  generation and aborts — never spending an LLM call on an uncommittable index (§5.1 "Unresolved merge
  conflicts in the index" edge case).
- **Identity transparency (§5.1 / §9.10.1) enforced at the integration site.** The new git subprocesses
  inherit repo config only — no identity injection — and the JSDoc cites the requirement. (The structural
  self-source-scan guard is P1.M3.T1, separate.)
- **Scope discipline.** S1 = pre-generation capture + the `gitRevParseHead` wrapper + JSDoc + test mocks.
  S2 (post-gen commit-tree + CAS) consumes `parentSha` + `treeSha`. S3 (rescue) adds the SIGINT/timeout
  path. T2.S1 (parallel) = ARG_MAX staging (disjoint region). T1.S1/S2/S3 = the plumbing primitives (inputs).
  **Zero overlap.**

## What

### User-visible behavior
None at the API surface (`smartCommit` signature/return unchanged). The only observable changes: (1) a
conflicted index now aborts before message generation (was: failed at `gitCommit` after the LLM call);
(2) a dangling tree object is created each commit (harmless — `git gc` reaps it; consumed by S2 once landed).

### Technical requirements (exact contract)

- **NEW `gitRevParseHead(repoPath?)` in `src/tools/git-mcp.ts`** — mirrors `gitWriteTree` exactly:
  `validateRepositoryPath` → `simpleGit(safePath)` → `git.raw(['rev-parse','HEAD'])` → trim →
  `{success:true, sha}`; on throw (HEAD unborn / rootless, or missing ref) → `{success:false, error:'HEAD is unborn (rootless repository — no commits yet)'}`.
  `GitRevParseHeadResult = {success:true; sha:string} | {success:false; error:string}`. Re-export via the
  existing block (L1077-1079). Argv vector (no shell); inherits repo config + env (no identity injection).
- **smartCommit insert** (after `await restore_critical_files(repoRoot);`, before `let formattedMessage`):
  - `const headResult = await gitRevParseHead(repoRoot);` → `const parentSha = headResult.success ? headResult.sha : undefined;` (undefined = rootless → root commit).
  - `const treeResult = await gitWriteTree(repoRoot);` → on `!treeResult.success`: `logger().error('Smart Commit aborted (unresolved merge conflicts): …'); return null;` (never-fail contract — no throw).
  - `const treeSha = treeResult.treeSha;` + `logger().debug({parentSha: parentSha ?? null, treeSha}, 'Captured pre-generation snapshot …')`.
  - Then the existing message-gen + `gitCommit` block continues VERBATIM.
- **Imports:** add `gitWriteTree`, `gitRevParseHead` to the existing `import { … } from '../tools/git-mcp.js';`.
- **Identity transparency:** the new subprocesses (`gitRevParseHead`, `gitWriteTree`) use `simpleGit.raw([...])`
  and inherit repo config + `process.env` — S1 adds NO `user.*` config write and NO `GIT_AUTHOR_*`/`GIT_COMMITTER_*`
  env. JSDoc cites §5.1 + §9.10.1.
- **smartCommit JSDoc (Mode A):** ADD bullets citing §5.1 "Snapshot-Based Atomic Single-Commit" (write-tree
  → [gen] → commit-tree → CAS update-ref; PARENT_SHA + TREE_SHA captured pre-generation here; CAS advance
  is S2) and §5.1 "Commit-identity transparency" (no identity injection). Keep the existing never-fail /
  retry / fallback wording.

### Success Criteria
- [ ] `gitRevParseHead` + `GitRevParseHeadResult` added to git-mcp.ts + re-exported (mirrors gitWriteTree).
- [ ] `smartCommit` calls `gitRevParseHead` → `parentSha` (undefined for rootless) + `gitWriteTree` → `treeSha`, after restore_critical_files, before message gen.
- [ ] `gitWriteTree` `{success:false}` → `smartCommit` logs + returns `null` WITHOUT calling `generateCommitMessage`/`gitCommit`.
- [ ] The existing message-gen + `gitCommit` path is byte-unchanged; `gitCommit` still runs.
- [ ] No `user.*` config / `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on any new git subprocess.
- [ ] `smartCommit` JSDoc cites §5.1 snapshot-based atomic commit + identity transparency.
- [ ] Mock factory + shared `beforeEach` defaults updated so every existing smartCommit test stays GREEN.
- [ ] New write-tree-conflict fail-fast test passes.
- [ ] `smartCommit` signature/return UNCHANGED.
- [ ] `npm run test:run -- git-commit` GREEN; `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The exact
smartCommit flow + insert point (with the never-fail try/catch), the verified `gitWriteTree` signature,
the ready-to-paste `gitRevParseHead` wrapper + smartCommit insert + JSDoc bullets, the test mock factory
+ the CRITICAL shared-defaults update (without which every existing test breaks) + the fail-fast test,
the disjoint-from-T2.S1 boundary, the identity-transparency constraint, and the verified validation
commands are all below.

### Documentation & References
```yaml
# MUST READ — ready-to-paste code + the insert point + the CRITICAL test-mock update + the gitRevParseHead rationale
- docfile: plan/015_459c7d9be558/P1M1T3S1/research/pre-generation-snapshot.md
  section: "1. Verified current state", "2. The plumbing inputs + the missing PARENT_SHA helper", "3. Ready-to-paste smartCommit insert", "5. JSDoc", "6. Tests", "7. Identity-transparency confirmation"
  why: Pins the exact insert point (after restore_critical_files L652, before message gen L654), the verbatim
        smartCommit insert, the gitRevParseHead wrapper, the JSDoc bullets, and — critically — why every
        existing smartCommit test breaks without the shared beforeEach mock defaults (vi.fn() returns undefined
        → treeResult.success throws → null) and exactly how to fix it.
  critical: ALL existing smartCommit tests need gitRevParseHead + gitWriteTree mocked to success in the shared
        beforeEach, or they regress to returning null. This is the #1 implementation trap.

# MUST READ — the smartCommit flow spec + the delta table
- docfile: plan/015_459c7d9be558/architecture/system_context.md
  section: "2.1 The commit path" (the gitStatus→gitAdd→restore_critical_files→gitDiff→generate→format→gitCommit flow) + "2.2 What changes for this delta"
  why: Confirms the insert point sits after restore_critical_files / before message gen, and that gitCommit is
        replaced by plumbing (write-tree→commit-tree→CAS) — S1 does the write-tree half pre-generation.

# MUST READ — the PRD mechanics + identity-transparency requirement
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Workflow Mechanics" + §9.10.1)
  section: §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" + "Commit-identity transparency"; §9.10.1 message-only delegation
  why: The write-tree step (freeze index → TREE_SHA), the PARENT_SHA capture before generation, the rootless
        edge case (PARENT_SHA empty), the conflict edge case (write-tree fails → abort before generation), and
        the identity-transparency MUST (no user.*/GIT_AUTHOR_*/GIT_COMMITTER_*).

# INPUT CONTRACTS — the plumbing primitives (Complete/Implementing)
- docfile: plan/015_459c7d9be558/P1M1T1S1/PRP.md
  why: gitWriteTree signature + result shape ({success:true,treeSha}|{success:false,error}) + the conflict-error
        string. Confirmed in source at src/tools/git-mcp.ts:627.

# PARALLEL ITEM (read-only — confirm no conflict; do NOT implement its changes)
- docfile: plan/015_459c7d9be558/P1M1T2S1/PRP.md
  why: T2.S1 (ARG_MAX staging) rewrites the staging block (~L620-660: gitAdd→pathspec + gitUnstagePath) and KEEPS
        restore_critical_files after staging. S1 inserts AFTER restore_critical_files — disjoint region.
        Anchor S1's insert on `await restore_critical_files(repoRoot);` (stable across both).

# EDIT TARGETS
- file: src/utils/git-commit.ts
  section: smartCommit L583-733 (insert after restore_critical_files L652); imports L24-26; JSDoc L526-582
  why: Insert the pre-generation capture; add imports; update JSDoc. NEVER touch simpleGit here (layering).
  gotcha: Anchor the insert on `await restore_critical_files(repoRoot);` — T2.S1 shifts lines above it.
- file: src/tools/git-mcp.ts
  section: add gitRevParseHead near gitWriteTree (~L627); re-export via the block at L1077-1079
  why: The PARENT_SHA wrapper (layering: git-commit.ts consumes git-mcp.ts wrappers, never simpleGit). Mirrors
        gitWriteTree's structure/result shape verbatim.
- file: tests/unit/utils/git-commit.test.ts
  section: mock factory L20-29; import L60-68; shared beforeEach mock defaults; add 1 fail-fast test
  why: Add the two new mocks + their shared success defaults (CRITICAL) + the conflict-abort test.

# FORMAT GATE
- command: "npm run test:run -- git-commit && npm run typecheck && npm run lint && npm run format:check"
  why: The project's standard gates (vitest run scoped; tsc --noEmit -p tsconfig.build.json; eslint; prettier).
```

### Current Codebase tree (edit surface)

```bash
src/tools/git-mcp.ts                # EDIT — +GitRevParseHeadResult type + gitRevParseHead fn + re-export
  ├─ gitWriteTree (L627)            # INPUT (Complete) — called by smartCommit
  ├─ gitRevParseHead                ← NEW (mirrors gitWriteTree; rev-parse HEAD; rootless-safe)
  └─ export { … gitWriteTree, gitCommitTree, gitUpdateRefCAS, gitRevParseHead } (L1077+)
src/utils/git-commit.ts             # EDIT — imports + smartCommit insert + JSDoc
  ├─ import { gitStatus, gitAdd, gitCommit, gitDiff, … } (L24-26)  # + gitWriteTree, gitRevParseHead
  ├─ smartCommit (L583)
  │   ├─ … gitStatus → gitAdd → restore_critical_files (L652)
  │   ├─ ← NEW: gitRevParseHead → parentSha; gitWriteTree → treeSha (abort-on-conflict → null)  [INSERT HERE]
  │   └─ … message-gen (generateCommitMessage/formatCommitMessage) → gitCommit (UNCHANGED) → return hash
  └─ smartCommit JSDoc (L526-582)   # + §5.1 snapshot + identity-transparency bullets
tests/unit/utils/git-commit.test.ts # EDIT — mock factory + import + shared beforeEach defaults + 1 fail-fast test
```

### Desired Codebase tree with files to be added/changed

```bash
src/tools/git-mcp.ts                # EDIT — +gitRevParseHead (plumbing wrapper) + re-export
src/utils/git-commit.ts             # EDIT — imports + smartCommit pre-generation insert + JSDoc
tests/unit/utils/git-commit.test.ts # EDIT — mocks + shared defaults + fail-fast test
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (test regression): EVERY existing smartCommit test calls the new gitRevParseHead + gitWriteTree.
//   A bare vi.fn() returns undefined → treeResult.success throws → outer catch → null → tests expecting a
//   hash BREAK. Add BOTH to the shared beforeEach as success defaults (research §6b). This is the #1 trap.

// CRITICAL (layering): git-commit.ts NEVER imports simpleGit or runs raw git directly (system_context §2.1,
//   T2.S1 PRP). PARENT_SHA capture MUST go through a git-mcp.ts wrapper (gitRevParseHead) — not inline simpleGit.

// CRITICAL (scope): S1 is PRE-generation ONLY. Do NOT replace gitCommit with commit-tree/update-ref (S2), do NOT
//   add the SIGINT/timeout rescue (S3). The existing message-gen + gitCommit path runs UNCHANGED; treeSha is
//   debug-logged (inert until S2 consumes it).

// GOTCHA (never-fail contract): the write-tree-conflict abort is log + return null — NOT a throw. The outer
//   try/catch already turns any throw into null, but the contract wants an explicit, logged, early return.

// GOTCHA (rootless repo): git rev-parse HEAD fails when HEAD is unborn (no commits) → gitRevParseHead returns
//   {success:false} → parentSha = undefined. That is the §5.1 "Rootless repo" edge case (commit-tree without
//   -p; update-ref without expected-old) — S1 captures undefined; S2 acts on it. Do NOT treat rootless as an error.

// GOTCHA (line drift): the parallel T2.S1 rewrites the staging block ABOVE the insert point. Anchor the insert
//   on `await restore_critical_files(repoRoot);` (unique; T2.S1 leaves it in place), not on a line number.

// GOTCHA (identity): gitRevParseHead + gitWriteTree use simpleGit.raw (argv vector, no shell) and inherit repo
//   config + process.env. Add NO user.name/user.email and NO GIT_AUTHOR_*/GIT_COMMITTER_* env. The structural
//   self-source-scan guard is P1.M3.T1 (separate); S1's job is to not inject + to cite the requirement in JSDoc.
```

## Implementation Blueprint

### Data models and structure
No new public data models. `GitRevParseHeadResult` (new, git-mcp.ts) mirrors `GitWriteTreeResult`.
`parentSha: string | undefined` and `treeSha: string` are locals in smartCommit (captured, debug-logged,
flowing to S2). `smartCommit`'s signature/return unchanged.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/git-mcp.ts — add the gitRevParseHead plumbing wrapper
  - ADD GitRevParseHeadResult type + gitRevParseHead async fn NEAR gitWriteTree (~L627). COPY-READY in research §2.
    Pattern: validateRepositoryPath → simpleGit → git.raw(['rev-parse','HEAD']) → trim → {success:true,sha};
    catch → {success:false, error:'HEAD is unborn (rootless repository — no commits yet)'}.
  - RE-EXPORT via the existing export block (L1077-1079): add gitRevParseHead (+ GitRevParseHeadResult if types are exported).
  - FOLLOW pattern: gitWriteTree (argv vector, structured result, validateRepositoryPath guard).
  - DO NOT: add identity env; touch gitWriteTree/gitCommitTree/gitUpdateRefCAS.

Task 2: EDIT src/utils/git-commit.ts — imports + smartCommit insert + JSDoc
  - (a) IMPORTS: add gitWriteTree + gitRevParseHead to the existing import from '../tools/git-mcp.js' (L24-26).
  - (b) INSERT (after `await restore_critical_files(repoRoot);` L652, before `let formattedMessage`): the
        pre-generation capture block — COPY-READY in research §3 (gitRevParseHead → parentSha; gitWriteTree →
        treeSha; abort-on-conflict → log + return null; debug log). Anchor on the restore_critical_files line.
  - (c) JSDoc (Mode A): ADD §5.1 snapshot-based-atomic-commit + identity-transparency bullets (research §5).
  - DO NOT: change the message-gen block, gitCommit, the signature/return, or the never-fail try/catch.

Task 3: EDIT tests/unit/utils/git-commit.test.ts — mocks + shared defaults + fail-fast test
  - (a) MOCK FACTORY (L20-29): add gitWriteTree: vi.fn() + gitRevParseHead: vi.fn().
  - (b) IMPORT (L60-68): add gitWriteTree + gitRevParseHead.
  - (c) SHARED beforeEach DEFAULTS (CRITICAL): wherever mockGitStatus/mockGitAdd success defaults are set,
        add vi.mocked(gitRevParseHead).mockResolvedValue({success:true, sha:'parent-sha-0001'}) and
        vi.mocked(gitWriteTree).mockResolvedValue({success:true, treeSha:'tree-sha-0001'}). (Every existing
        smartCommit test needs these or it regresses to null.)
  - (d) NEW TEST: write-tree {success:false} → smartCommit returns null, NEVER calls generateCommitMessage/gitCommit.
        COPY-READY in research §6c. (Optional: rootless repo → parentSha undefined, write-tree succeeds, proceeds.)
  - PRESERVE: all existing smartCommit tests (now GREEN with the new defaults).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: gitRevParseHead mirrors gitWriteTree (research §2)
async function gitRevParseHead(repoPath?: string): Promise<GitRevParseHeadResult> {
  const safePath = await validateRepositoryPath(repoPath);
  const git = simpleGit(safePath);
  try {
    const sha = (await git.raw(['rev-parse', 'HEAD'])).trim();
    return { success: true, sha };
  } catch {
    return { success: false, error: 'HEAD is unborn (rootless repository — no commits yet)' };
  }
}

// PATTERN: the smartCommit insert — capture, abort-on-conflict, debug-log (research §3)
const headResult = await gitRevParseHead(repoRoot);
const parentSha = headResult.success ? headResult.sha : undefined; // rootless → root commit (S2)
const treeResult = await gitWriteTree(repoRoot);
if (!treeResult.success) {
  logger().error(`Smart Commit aborted (unresolved merge conflicts): ${treeResult.error}`);
  return null; // never-fail contract — no throw; HEAD/index byte-for-byte unchanged
}
const treeSha = treeResult.treeSha;
logger().debug({ parentSha: parentSha ?? null, treeSha }, 'Captured pre-generation snapshot');
// …existing message-gen + gitCommit block continues UNCHANGED…

// GOTCHA (above): every existing smartCommit test needs gitRevParseHead + gitWriteTree mocked to success in
//   the shared beforeEach, or the new calls return undefined → treeResult.success throws → null → regression.
```

### Integration Points
```yaml
IMPORTS (src/utils/git-commit.ts):
  - add: gitWriteTree, gitRevParseHead to the existing import from '../tools/git-mcp.js'

NEW SYMBOL (src/tools/git-mcp.ts):
  - "type GitRevParseHeadResult" + "async function gitRevParseHead(repoPath?)" + re-export   # mirrors gitWriteTree

SMARTCOMMIT INSERT (after restore_critical_files, before message gen — anchored on the restore line):
  - gitRevParseHead(repoRoot) → parentSha (string | undefined)
  - gitWriteTree(repoRoot) → treeSha (abort-on-conflict → log + return null)
  - debug log {parentSha, treeSha}

DOWNSTREAM CONSUMERS (NOT this task — S2 consumes the captured values):
  - P1.M1.T3.S2: gitCommitTree({treeSha, parentSha, message}) + gitUpdateRefCAS({newSha, expectedOldSha: parentSha}) replace gitCommit.
  - P1.M1.T3.S3: the SIGINT/timeout rescue surfaces treeSha + the manual recovery command.

NONE OF: the message-gen block, gitCommit, smartCommit signature/return, simpleGit (layering), PRD.md,
         spec/**, **/tasks.json, the staging block (T2.S1), the plumbing primitives themselves (T1.S1/S2/S3).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0 (gitRevParseHead resolves; smartCommit typechecks)
npm run lint             # eslint — clean
npm run format:check     # prettier — clean (run `npm run format` if it flags)
# Expected: zero errors.
```

### Level 2: Unit Tests (the PRIMARY gate)
```bash
npm run test:run -- git-commit
# Expected: GREEN. The new write-tree-conflict fail-fast test passes (returns null, never reaches gen/gitCommit).
#   ALL existing smartCommit tests pass WITH the new shared gitRevParseHead/gitWriteTree success defaults.
#   If existing tests regress to null, the shared beforeEach defaults are missing (Task 3c).
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm the insert is positioned correctly (after restore_critical_files, before message gen) and gitCommit still runs.
grep -n 'restore_critical_files\|gitRevParseHead\|gitWriteTree\|generateCommitMessage\|gitCommit' src/utils/git-commit.ts
# Expected ordering: restore_critical_files → gitRevParseHead → gitWriteTree → (generateCommitMessage|formatCommitMessage) → gitCommit.
# Confirm identity transparency: no user.*/GIT_AUTHOR_*/GIT_COMMITTER_* literals introduced in this path.
grep -n 'user\.name\|user\.email\|GIT_AUTHOR_\|GIT_COMMITTER_' src/utils/git-commit.ts src/tools/git-mcp.ts | grep -v '^\s*//' || echo "OK: no identity-injection literals"
git status --porcelain | grep -E '^\s*[AM]\s+(PRD\.md|spec/|.*tasks\.json|prd_snapshot)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no PRD/spec/tasks files modified"
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual conflict-fail-fast proof against a throwaway tmp git repo (no agent/LLM call).
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import simpleGit from 'simple-git';
const t = mkdtempSync(join(tmpdir(), 'pregen-'));
const g = simpleGit(t);
await g.init(); await g.add('.'); await g.commit('init');
writeFileSync(join(t,'f.txt'),'v1'); await g.add('.'); await g.commit('one');
// simulate an unresolved merge conflict in the index:
writeFileSync(join(t,'f.txt'),'conflict'); await g.raw(['add','.']);
await g.merge(['--no-commit','--no-ff','HEAD']); // leave a conflicted-looking index state is hard; instead:
// Direct proof: gitWriteTree on a clean repo returns a treeSha; the smartCommit wiring is unit-tested above.
import { gitWriteTree, gitRevParseHead } from './src/tools/git-mcp.js';
console.log('rev-parse:', JSON.stringify(await gitRevParseHead(t)));
console.log('write-tree:', JSON.stringify(await gitWriteTree(t)));
"
# Expected: rev-parse {success:true, sha:<40char>}; write-tree {success:true, treeSha:<40char>}. (The
#   conflict-fail-fast behavior itself is proven by the Level-2 unit test, which mocks write-tree → {success:false}.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 typecheck/lint/format:check clean.
- [ ] Level 2 `npm run test:run -- git-commit` GREEN (new fail-fast test + all existing smartCommit tests).
- [ ] Level 3 insert ordered correctly (restore → rev-parse → write-tree → gen → gitCommit); no identity-injection literals.
- [ ] Level 4 rev-parse + write-tree return structured success results on a real repo.

### Feature Validation
- [ ] `gitRevParseHead` + `gitWriteTree` called after restore_critical_files; `parentSha` + `treeSha` captured.
- [ ] `gitWriteTree {success:false}` → log + return null, no `generateCommitMessage`/`gitCommit` call (fail-fast).
- [ ] Rootless repo → `parentSha === undefined` (not an error).
- [ ] Existing message-gen + `gitCommit` path byte-unchanged.
- [ ] smartCommit signature/return unchanged.

### Code Quality Validation
- [ ] `gitRevParseHead` mirrors `gitWriteTree` (argv vector, structured result, validateRepositoryPath).
- [ ] smartCommit JSDoc cites §5.1 snapshot-based atomic commit + identity transparency.
- [ ] No `user.*`/`GIT_AUTHOR_*`/`GIT_COMMITTER_*` injection; layering preserved (no simpleGit in git-commit.ts).
- [ ] Insert anchored on `await restore_critical_files(repoRoot);` (survives T2.S1's line drift).

### Documentation & Deployment
- [ ] No docs files in this task (Mode-B sweep is P3 — separate milestone).
- [ ] No env-var / config additions.

---

## Anti-Patterns to Avoid
- ❌ Don't forget the shared `beforeEach` mock defaults for `gitRevParseHead` + `gitWriteTree` — without them, EVERY existing smartCommit test regresses to `null` (vi.fn() → undefined → `treeResult.success` throws → caught → null). This is the #1 trap.
- ❌ Don't replace `gitCommit` with `commit-tree`/`update-ref`, or add the SIGINT rescue — that's S2/S3. S1 is pre-generation capture only; the existing message-gen + `gitCommit` path runs unchanged.
- ❌ Don't import `simpleGit` into `git-commit.ts` or run raw git there — layering forces PARENT_SHA capture through a `gitRevParseHead` wrapper in git-mcp.ts. (The contract's "no new exports" = smartCommit's surface unchanged; the wrapper is the layering-correct way to read HEAD.)
- ❌ Don't throw on the write-tree conflict — the never-fail contract wants log + `return null`.
- ❌ Don't treat a rootless repo (HEAD unborn → `gitRevParseHead {success:false}`) as an error — `parentSha = undefined` is the §5.1 "Rootless repo" edge case; S1 captures it, S2 acts on it.
- ❌ Don't set `user.name`/`user.email` or pass `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env on the new subprocesses — identity transparency (§5.1/§9.10.1). The structural guard is P1.M3.T1; S1's job is to not inject + cite the requirement.
- ❌ Don't anchor the insert on a line number — T2.S1 (parallel) rewrites the staging block above it. Anchor on `await restore_critical_files(repoRoot);`.
- ❌ Don't touch the staging block — that's T2.S1 (parallel). Don't touch the plumbing primitives themselves — those are T1.S1/S2/S3 (inputs).
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted `git-commit` suite (Level 2).