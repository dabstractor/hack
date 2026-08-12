# PRP — P1.M1.T3.S2: Post-generation commit-tree + CAS update-ref, edge-case handling

> Plan 015, PRD §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" → edge cases
> ("HEAD moved during generation"). This is the **post-generation step** of the 3-subtask `smartCommit`
> plumbing rewrite (S1 pre-gen capture → **S2 commit-tree + CAS update-ref** → S3 rescue). S2 **replaces
> simple-git's `gitCommit`** with `gitCommitTree` (dangling commit from S1's `TREE_SHA` + `PARENT_SHA`) →
> `gitUpdateRefCAS` (atomic HEAD advance). On CAS refusal (HEAD moved during generation) it **MUST NOT
> force**: it surfaces the generated message + a manual recovery recipe and exits non-zero (a narrow,
> safety-critical exception to smartCommit's never-fail contract). The message-resolution + retry/fallback
> layer is UNCHANGED — both the generated and the fallback-placeholder messages flow through the same
> plumbing commit. Architecture: `plan/015_459c7d9be558/architecture/system_context.md §2.1`.

---

## Goal

**Feature Goal**: In `smartCommit` (`src/utils/git-commit.ts`), replace the `gitCommit` call (current
L727-740) with the §5.1 snapshot-based atomic plumbing path: (1) `gitCommitTree({repoPath, treeSha,
message, parentSha})` → `newSha` (dangling commit; `parentSha` undefined for a rootless repo → root
commit, no `-p`); (2) `gitUpdateRefCAS({repoPath, newSha, expectedOldSha: parentSha})` (omitted for
rootless → unconditional advance). On CAS `{success:false, casFailure:true}` → **MUST NOT force**: log +
throw a typed `CommitCasRefusedError` carrying a manual recovery recipe, and make smartCommit's outer
catch **re-throw** it (narrow never-fail exception) so the process exits non-zero. Add the
`formatCommitRecoveryRecipe` helper + the `CommitCasRefusedError` class. Migrate the test suite from
`gitCommit` mocks to the plumbing pair + add the CAS-refusal/rootless/fallback-plumbing tests. Update the
smartCommit + helper JSDoc (Mode A).

**Deliverable**:
1. **`src/utils/errors.ts`** — NEW `CommitCasRefusedError extends PipelineError` (mirror `AgentError`
   L422-425 exactly).
2. **`src/utils/git-commit.ts`** — (a) import `gitCommitTree` + `gitUpdateRefCAS` (git-mcp) +
   `CommitCasRefusedError` (errors); (b) replace the `gitCommit` block with commit-tree → CAS; (c) re-throw
   `CommitCasRefusedError` from the outer catch; (d) NEW `formatCommitRecoveryRecipe` helper + its JSDoc;
   (e) updated smartCommit JSDoc. The message-gen + retry/fallback block is UNCHANGED.
3. **`tests/unit/utils/git-commit.test.ts`** — (a) add `gitCommitTree` + `gitUpdateRefCAS` to the mock
   factory + import + `vi.mocked` refs; (b) shared `beforeEach` defaults for both (so existing happy-path
   tests stay green via the new path); (c) **migrate ~10 sites** from `mockGitCommit` to the plumbing pair;
   (d) NEW tests: commit-tree-fails → null, CAS-refusal → throws + logs recipe, rootless → root-commit
   path, fallback uses plumbing. Early-return tests (asserting `gitCommit` not called) stay green untouched.

**Success Definition**:
- `smartCommit`, after message resolution, calls `gitCommitTree({repoPath, treeSha, message, parentSha})`
  → `newSha`, then `gitUpdateRefCAS({repoPath, newSha, expectedOldSha: parentSha})`. On CAS success →
  returns `newSha` (the commit SHA string).
- `gitCommitTree {success:false}` → log + `return null` (never-fail; HEAD/index unchanged).
- `gitUpdateRefCAS {success:false, casFailure:true}` → log the recovery recipe (containing treeSha,
  parentSha, newSha, the message, and the `git commit-tree … | xargs git update-ref HEAD` command) +
  `throw new CommitCasRefusedError(recipe, …)`. smartCommit's outer catch **re-throws** it (NOT swallowed
  to null) → process exits non-zero.
- Rootless repo (`parentSha === undefined`): `gitCommitTree` called with `parentSha: undefined` (no `-p`,
  root commit); `gitUpdateRefCAS` called with `expectedOldSha: undefined` (unconditional advance).
- Fallback path (generation fails after retries → `buildFallbackCommitMessage`): the placeholder message
  flows through the SAME `gitCommitTree` + `gitUpdateRefCAS` (NOT `gitCommit`).
- `npm run test:run -- git-commit` GREEN (~10 migrated sites + ~4 new tests; early-return tests unchanged).
- `npm run typecheck` exit 0; `npm run lint` + `npm run format:check` clean.

## User Persona

N/A — internal commit-subsystem. Indirect "users" are the pipeline's survival/recovery commits (every
work-item pre/post-cleanup commit) and the human operator who, on the rare CAS refusal, receives the
recovery recipe instead of a silently-clobbered history.

## Why

- **Closes §5.1 "Commit Workflow Mechanics" step 3 (the only step that moves HEAD).** S1 froze the index
  into `TREE_SHA` + captured `PARENT_SHA` pre-generation; S2 composes the dangling commit and advances HEAD
  atomically (CAS). This is what makes the whole commit atomic: every code path that doesn't reach a
  successful `update-ref` leaves HEAD + the index byte-for-byte unchanged.
- **The CAS-refusal edge case is safety-critical and MUST NOT be swallowed.** A concurrent commit moved
  HEAD during the (slow) message-generation window. Forcing the advance would silently overwrite that
  commit — the exact failure mode this plumbing commit exists to prevent. §5.1 mandates "MUST NOT force …
  surfaces the generated message plus a manual recovery recipe … and exits non-zero." That is a deliberate,
  narrow exception to smartCommit's never-fail contract (substance is safe as a dangling commit; a human
  recovers via the recipe).
- **Fallback path honors the new mechanism.** The item requirement: "on fallback, use the PLUMBING commit
  with the placeholder message (not simple-git's git.commit())." Since both the generated and fallback
  messages converge on `formattedMessage` before the commit block, the single plumbing path serves both —
  no `gitCommit` remains anywhere in smartCommit.
- **Unblocks S3.** S3 (SIGINT/timeout rescue) reuses `treeSha` + the manual recovery command surface; it
  needs the plumbing commit in place.

## What

### User-visible behavior
None at the API surface (`smartCommit` signature unchanged). Observable changes: (1) commits are now
created via plumbing (identity-transparent — authored by whoever git resolves from user config; no machine
author, no trailer); (2) a concurrent-commit race during generation now throws `CommitCasRefusedError`
(was: silently advanced via `gitCommit`); (3) the returned hash is `gitCommitTree`'s `commitSha`.

### Technical requirements (exact contract)

**Replace** the `gitCommit` block (current L727-740) with commit-tree → CAS (research §3 — copy-ready).
The two locals `parentSha` (string|undefined) and `treeSha` (string) come from S1's pre-generation capture.
- `gitCommitTree({repoPath: repoRoot, treeSha, message: formattedMessage, parentSha})` — `parentSha`
  undefined passes through as omitted (root commit). `{success:false}` → log + `return null`.
- `gitUpdateRefCAS({repoPath: repoRoot, newSha, expectedOldSha: parentSha})` — `parentSha` undefined →
  omitted (unconditional advance). `{success:false, casFailure:true}` → build the recipe via
  `formatCommitRecoveryRecipe`, `logger().error(recipe)`, `throw new CommitCasRefusedError(recipe,
  {treeSha, parentSha, newSha})`.
- On CAS success: `logger().info('Commit created: <newSha>')`; `return newSha`.

**Outer catch re-throws the CAS refusal** (research §3 — copy-ready):
```ts
  } catch (error) {
    if (error instanceof CommitCasRefusedError) throw error; // safety-critical: propagate → non-zero exit
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Unexpected error: ${errorMessage}`);
    return null;
  }
```
All other failures still `return null` (never-fail). smartCommit's return type stays `string | null`; it
now also `throws CommitCasRefusedError` (documented).

**NEW `formatCommitRecoveryRecipe`** (git-commit.ts) — research §4 — renders the §5.1 recipe: a header
("CAS refused … MUST NOT force"), treeSha/parentSha(or rootless note)/newSha/message(git-error), and the
copy-paste command `git commit-tree [-p <PARENT_SHA>] -m "<msg>" <TREE_SHA> | xargs git update-ref HEAD`
(`-p` omitted for rootless). Export it (so S3/tests can reuse).

**NEW `CommitCasRefusedError extends PipelineError`** (errors.ts) — mirror `AgentError` (L422-425)
exactly: `constructor(message, context?, cause?) { super(message, context, cause); }`. This lands it in
the established `PipelineError` family so the orchestrator's `main().catch` (handles `PipelineError` →
non-zero) propagates it naturally.

**Imports** (git-commit.ts): add `gitCommitTree`, `gitUpdateRefCAS` to `import { … } from '../tools/git-mcp.js';`
and `CommitCasRefusedError` to the errors import.

**JSDoc (Mode A):** smartCommit — add §5.1 snapshot-based-atomic-commit bullets (write-tree S1 → gen →
commit-tree → CAS) + the "HEAD moved during generation" edge case (CAS refuses; MUST NOT force; surfaces
message + recovery recipe; exits non-zero via `CommitCasRefusedError` — narrow never-fail exception);
update `@returns` to note it can throw. `formatCommitRecoveryRecipe` — cite the §5.1 edge-case sentence.

**Unchanged:** the message-resolution block (`generateCommitMessage` retry → `formatCommitMessage`, and
the `buildFallbackCommitMessage` fallback → `formatCommitMessage`), `formatCommitMessage`, S1's
pre-generation capture, the smartCommit signature, `restore_critical_files`, and ALL staging.

### Success Criteria
- [ ] `gitCommit` block replaced by `gitCommitTree` → `gitUpdateRefCAS`; `gitCommit` no longer called anywhere in smartCommit.
- [ ] `gitCommitTree {success:false}` → log + return null; `gitUpdateRefCAS` not called.
- [ ] `gitUpdateRefCAS {success:false, casFailure:true}` → logs recovery recipe + throws `CommitCasRefusedError`; smartCommit's catch re-throws it (rejects, not null).
- [ ] Rootless (`parentSha === undefined`): commit-tree called with `parentSha: undefined`; update-ref with `expectedOldSha: undefined`.
- [ ] Fallback message flows through the plumbing commit (placeholder → `gitCommitTree`).
- [ ] Returns `gitCommitTree`'s `commitSha` on success.
- [ ] `CommitCasRefusedError extends PipelineError` in errors.ts (mirrors AgentError); `formatCommitRecoveryRecipe` exported.
- [ ] smartCommit + helper JSDoc cite §5.1 snapshot + the CAS-refusal edge case + non-zero exit.
- [ ] Test mock factory + shared beforeEach updated; ~10 sites migrated; ~4 new tests; early-return tests green.
- [ ] `npm run test:run -- git-commit` GREEN; `npm run typecheck` exit 0; lint + format:check clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes.** The verbatim
plumbing signatures + result shapes (gitCommitTree/gitUpdateRefCAS), the exact block being replaced
(L727-740) + the copy-ready replacement, the outer-catch re-throw, the recovery-recipe helper, the
PipelineError-subclass convention (mirror AgentError), the S1-provided locals (parentSha/treeSha) + their
test-mock defaults, the #1 trap (the ~10-site gitCommit→plumbing test migration, with exact line sites),
the new tests (CAS-refusal/rootless/fallback-plumbing), and the verified validation commands are all below.

### Documentation & References
```yaml
# MUST READ — copy-ready replacement + catch re-throw + helper + error class + the test-migration map
- docfile: plan/015_459c7d9be558/P1M1T3S2/research/post-generation-commit-cas.md
  section: "1. The plumbing primitives", "2. The block S2 replaces", "3. The replacement", "4. The recovery-recipe helper + typed error", "5. Test strategy — the BIG migration"
  why: Every code change is copy-ready; the test section lists the exact ~10 mockGitCommit sites to migrate + the shared-beforeEach defaults + the 4 new tests.
  critical: The outer catch MUST re-throw CommitCasRefusedError or the CAS refusal is swallowed to null (defeating §5.1 "exits non-zero"). The #1 trap is the ~10-site test migration.

# MUST READ — the smartCommit flow + the delta
- docfile: plan/015_459c7d9be558/architecture/system_context.md
  section: "2.1 The commit path", "2.2 What changes for this delta"
  why: Confirms the block S2 replaces is the trailing gitCommit call, and that the message-gen/retry/fallback layer above it is unchanged.

# AUTHORITATIVE SPEC — §5.1 mechanics + the CAS-refusal edge case
- docfile: PRD.md   # (provided in selected_prd_content §5.1 "Commit Workflow Mechanics" + "Edge cases")
  section: §5.1 "Commit Workflow Mechanics (Snapshot-Based Atomic Single-Commit)" + "Edge cases" (Rootless repo; HEAD moved during generation)
  why: The commit-tree step (dangling from TREE_SHA + PARENT_SHA), the CAS update-ref (advance only if HEAD==PARENT_SHA), the "MUST NOT force … manual recovery recipe … exits non-zero" mandate, and the rootless edge case (no -p / no expected-old).

# PREDECESSOR (read as a CONTRACT) — S1 produces parentSha + treeSha
- docfile: plan/015_459c7d9be558/P1M1T3S1/PRP.md
  section: "What → Technical requirements", "Known Gotchas" (never-fail; rootless; identity)
  why: S1 captures parentSha (gitRevParseHead, undefined=rootless) + treeSha (gitWriteTree) after restore_critical_files, BEFORE message gen — both flow into S2's gitCommitTree/gitUpdateRefCAS. S1 also added their test-mock shared defaults ('parent-sha-0001'/'tree-sha-0001').
  critical: S2 CONSUMES parentSha + treeSha; do NOT re-capture them. S1's shared beforeEach defaults are already in place — S2 adds gitCommitTree + gitUpdateRefCAS defaults alongside them.

# INPUT CONTRACTS — the plumbing primitives (Complete)
- file: src/tools/git-mcp.ts
  section: gitCommitTree (L651-693) → {success:true,commitSha}|{success:false,error}; gitUpdateRefCAS (L720-782) → {success:true}|{success:false,error,casFailure:true}
  why: Exact signatures + the casFailure:true invariant (every failure). gitCommitTree's parentSha optional (root commit); gitUpdateRefCAS's expectedOldSha optional (unconditional). Both argv-vector (no shell), inherit repo config (no identity injection).
  gotcha: gitUpdateRefCAS is SILENT on success (no payload) — return {success:true}. casFailure:true is ALWAYS present on {success:false}.

# ERROR CONVENTION — mirror AgentError for the typed CAS-refused error
- file: src/utils/errors.ts
  section: PipelineError (L145, abstract, constructor (message, context?, cause?)); AgentError (L422-425)
  why: CommitCasRefusedError extends PipelineError, mirroring AgentError's constructor exactly. Lands it in the PipelineError family → orchestrator's main().catch propagates it (non-zero exit).
  gotcha: Do NOT invent a new base or skip the context/cause args — mirror AgentError verbatim.

# EDIT TARGET — the smartCommit commit block + outer catch + imports + JSDoc
- file: src/utils/git-commit.ts
  section: imports (add gitCommitTree/gitUpdateRefCAS + CommitCasRefusedError); smartCommit commit block (~L727-740 → replace); outer catch (~L741 → re-throw CommitCasRefusedError); NEW formatCommitRecoveryRecipe; smartCommit JSDoc (~L526-582)
  why: The core edits. The message-gen/retry/fallback block ABOVE the commit block is UNCHANGED (formattedMessage produced identically).
  gotcha: The catch re-throw is mandatory — without it the CAS refusal is swallowed to null. Locate the block by `await gitCommit({` (grep), not line number (S1/T2.S1 shift lines).

# TEST PATTERN — the mock factory + the migration sites
- file: tests/unit/utils/git-commit.test.ts
  section: mock factory (L20-29, +gitCommitTree/gitUpdateRefCAS); import (L65); vi.mocked refs (L90-97); shared beforeEach (L114+, +plumbing success defaults); ~10 mockGitCommit sites (L482/514/659/713/786/810/833/857/1260); the "no commitHash" test (L684-697 → reframe to commit-tree-fails); early-return tests (L544/559/627/646, unchanged)
  why: The full test-migration map. Every happy-path site switches gitCommit→gitCommitTree+gitUpdateRefCAS; the shared defaults keep them green; new tests cover CAS-refusal/rootless/fallback-plumbing.
  gotcha: A missed site = a happy-path test regresses to null (gitCommitTree returns undefined → commitTreeResult.success throws → catch → null). Grep-gate `mockGitCommit.mockResolvedValue` at the end.

# FORMAT GATE
- command: "npm run test:run -- git-commit && npm run typecheck && npm run lint && npm run format:check"
  why: The project's standard gates (vitest scoped; tsc --noEmit -p tsconfig.build.json; eslint; prettier).
```

### Current Codebase tree (edit surface)

```bash
src/utils/errors.ts               # EDIT — +CommitCasRefusedError extends PipelineError (mirror AgentError)
src/utils/git-commit.ts           # EDIT — imports + replace gitCommit block + catch re-throw + helper + JSDoc
  ├─ import { … gitStatus, gitAdd, gitDiff, gitWriteTree, gitRevParseHead, … }   # + gitCommitTree, gitUpdateRefCAS
  ├─ import { … } from './errors.js'                                             # + CommitCasRefusedError
  ├─ smartCommit (L583)
  │   ├─ [S1: gitRevParseHead→parentSha; gitWriteTree→treeSha]                   # UNCHANGED (predecessor)
  │   ├─ message-gen block (generateCommitMessage retry | buildFallbackCommitMessage) → formatCommitMessage  # UNCHANGED
  │   ├─ ← REPLACE: gitCommit({...}) → gitCommitTree({...}) → gitUpdateRefCAS({...}) → return newSha  [EDIT]
  │   └─ catch (error) { if (CommitCasRefusedError) throw; … return null; }      # [EDIT: + re-throw]
  ├─ formatCommitRecoveryRecipe                                                  ← NEW (exported)
  └─ smartCommit JSDoc (~L526-582)                                               # + §5.1 snapshot + CAS edge case
tests/unit/utils/git-commit.test.ts # EDIT — mock factory + import + shared defaults + ~10 site migration + ~4 new tests
src/tools/git-mcp.ts              # READ-ONLY (gitCommitTree/gitUpdateRefCAS — inputs, Complete)
```

### Desired Codebase tree with files to be changed
```bash
src/utils/errors.ts               # EDIT — +CommitCasRefusedError
src/utils/git-commit.ts           # EDIT — imports + commit block + catch + helper + JSDoc
tests/unit/utils/git-commit.test.ts # EDIT — mocks + shared defaults + migration + new tests
# (no new files; gitCommit is removed from smartCommit but stays exported/used elsewhere if any — S2 only changes smartCommit's call)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL (never-fail exception): the outer catch MUST re-throw CommitCasRefusedError. Without it, the
//   CAS refusal is caught → return null → the process does NOT exit non-zero and the recovery recipe is
//   swallowed. §5.1 mandates "exits non-zero." This is the #2 trap (after the test migration).

// CRITICAL (test migration — #1 trap): every existing happy-path test mocks `gitCommit.mockResolvedValue(
//   {success:true, commitHash:'abc'})`. After S2 gitCommit is never called → gitCommitTree returns
//   undefined (vi.fn default) → commitTreeResult.success throws → catch → null → REGRESSION. Migrate
//   ALL ~10 sites to mockGitCommitTree + mockGitUpdateRefCAS, AND add shared-beforeEach success defaults.

// CRITICAL (MUST NOT force): on casFailure:true, do NOT retry without expectedOldSha, do NOT fall back to
//   gitCommit, do NOT pass --force. Throw CommitCasRefusedError. Forcing would clobber a concurrent commit.

// GOTCHA (rootless): parentSha === undefined (S1's gitRevParseHead returned {success:false}). Pass it
//   through: gitCommitTree({parentSha: undefined}) → no -p (root commit); gitUpdateRefCAS({expectedOldSha:
//   undefined}) → unconditional advance. Do NOT treat undefined as an error.

// GOTCHA (fallback uses plumbing): the buildFallbackCommitMessage path produces formattedMessage and
//   converges on the SAME commit block — so the placeholder message automatically goes through
//   gitCommitTree. Do NOT add a separate gitCommit for the fallback. Verify with a test.

// GOTCHA (return value): return gitCommitTree's commitSha (newSha), NOT a gitCommit commitHash. The migrated
//   happy-path tests must assert the return === the mockGitCommitTree commitSha literal.

// GOTCHA (identity transparency): S2 adds NO new git subprocess in git-commit.ts (it calls the wrappers).
//   The wrappers inherit repo config (no user.*/GIT_AUTHOR_*/GIT_COMMITTER_*). The structural guard is P1.M3.

// GOTCHA (locate by grep): S1 + T2.S1 (parallel) shift line numbers. Grep for `await gitCommit({` and the
//   outer `} catch (error) {` — do not trust L727/L741.

// GOTCHA (CommitCasRefusedError home): put it in errors.ts (the PipelineError home) so callers can
//   `instanceof` it and main().catch propagates it. Mirror AgentError's constructor EXACTLY (message,
//   context?, cause?).
```

## Implementation Blueprint

### Data models and structure
No new public data models beyond `CommitCasRefusedError` (a `PipelineError` subclass) and the
`formatCommitRecoveryRecipe` pure helper. The plumbing result types (`GitCommitTreeResult`,
`GitUpdateRefCASResult`) already exist (T1.S2/S3). `parentSha`/`treeSha` are S1 locals (consumed, not
re-defined). smartCommit's signature is unchanged; its return stays `string | null` and it now also throws
`CommitCasRefusedError`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/utils/errors.ts — add CommitCasRefusedError
  - ADD `export class CommitCasRefusedError extends PipelineError { constructor(message, context?, cause?) {
    super(message, context, cause); } }` mirroring AgentError (L422-425) EXACTLY (same args/order).
  - NAMING: CommitCasRefusedError (descriptive; matches the casFailure semantic). PLACEMENT: near AgentError.
  - DO NOT: invent a new base; change PipelineError; add a `code` unless AgentError has one (mirror it).

Task 2: EDIT src/utils/git-commit.ts — imports + replace commit block + catch re-throw + helper + JSDoc
  - (a) IMPORTS: add gitCommitTree + gitUpdateRefCAS to the git-mcp import; CommitCasRefusedError to the
        errors import.
  - (b) REPLACE the `await gitCommit({path: repoRoot, message: formattedMessage})` block (~L727-740) with
        commit-tree → CAS (research §3 — copy-ready). On commit-tree {success:false} → log + return null.
        On CAS {success:false} → formatCommitRecoveryRecipe + logger().error + throw CommitCasRefusedError.
        On success → logger().info + return newSha.
  - (c) OUTER CATCH (~L741): add `if (error instanceof CommitCasRefusedError) throw error;` BEFORE the
        existing errorMessage/null path (research §3). All other errors still → null.
  - (d) NEW `export function formatCommitRecoveryRecipe({...})` (research §4 — copy-ready) + its JSDoc.
  - (e) JSDoc (Mode A): smartCommit — + §5.1 snapshot-based-atomic-commit + the CAS-refusal edge case
        (MUST NOT force; surfaces message + recipe; exits non-zero via CommitCasRefusedError; narrow
        never-fail exception); update @returns to note the throw. research §6.
  - DO NOT: touch the message-gen/retry/fallback block, formatCommitMessage, S1's capture, staging,
        restore_critical_files, or the signature.

Task 3: EDIT tests/unit/utils/git-commit.test.ts — mocks + shared defaults + migration + new tests
  - (a) MOCK FACTORY (L20-29): + gitCommitTree: vi.fn() + gitUpdateRefCAS: vi.fn().
  - (b) IMPORT (L65) + vi.mocked refs (L90-97): + gitCommitTree + gitUpdateRefCAS (+ CommitCasRefusedError
        from errors for the rejects.toThrow assertion).
  - (c) SHARED beforeEach (L114+): + mockGitCommitTree.mockResolvedValue({success:true, commitSha:'new-sha-0001'})
        + mockGitUpdateRefCAS.mockResolvedValue({success:true}). (Keeps all happy-path tests green.)
  - (d) MIGRATE ~10 sites: replace `mockGitCommit.mockResolvedValue({success:true, commitHash:'abc…'})` with
        `mockGitCommitTree.mockResolvedValue({success:true, commitSha:'abc…'})` +
        `mockGitUpdateRefCAS.mockResolvedValue({success:true})`; replace `expect(mockGitCommit).toHaveBeenCalledWith(
        {path, message})` with the gitCommitTree({repoPath, treeSha:'tree-sha-0001', message, parentSha:
        'parent-sha-0001'}) + gitUpdateRefCAS({repoPath, newSha:'abc…', expectedOldSha:'parent-sha-0001'})
        assertions. Sites: L482, L514, L659, L713, L786, L810, L833, L857, L1260.
  - (e) REFRAME L684-697 ("no commitHash → null"): → "commit-tree fails → null"
        (mockGitCommitTree {success:false, error:'bad tree'} → returns null, mockGitUpdateRefCAS not called).
  - (f) NEW tests (research §5): commit-tree-fails → null; CAS casFailure → rejects.toThrow(
        CommitCasRefusedError) + logger.error spy contains the recipe command + treeSha/parentSha/newSha;
        rootless (override gitRevParseHead→{success:false}) → gitCommitTree called with parentSha:undefined +
        gitUpdateRefCAS with expectedOldSha:undefined; fallback (agent throws) → gitCommitTree called with the
        buildFallbackCommitMessage placeholder.
  - PRESERVE: early-return tests (L544/559/627/646 — `mockGitCommit` not called, still true); generateCommitMessage
        tests (L915+ — unchanged).
```

### Implementation Patterns & Key Details
```ts
// PATTERN: the replacement (research §3) — commit-tree → CAS, with the rootless passthrough
const commitTreeResult = await gitCommitTree({
  repoPath: repoRoot, treeSha, message: formattedMessage, parentSha, // undefined → root commit (no -p)
});
if (!commitTreeResult.success) { logger().error(`commit-tree failed: ${commitTreeResult.error}`); return null; }
const newSha = commitTreeResult.commitSha;
const casResult = await gitUpdateRefCAS({
  repoPath: repoRoot, newSha, expectedOldSha: parentSha, // undefined → unconditional advance (rootless)
});
if (!casResult.success) {
  const recipe = formatCommitRecoveryRecipe({ message: formattedMessage, treeSha, parentSha, newSha, error: casResult.error });
  logger().error(recipe);
  throw new CommitCasRefusedError(recipe, { treeSha, parentSha, newSha }); // §5.1: MUST NOT force; exit non-zero
}
logger().info(`Commit created: ${newSha}`);
return newSha;

// PATTERN: the outer catch re-throw (research §3) — the narrow never-fail exception
} catch (error) {
  if (error instanceof CommitCasRefusedError) throw error; // safety-critical: propagate → non-zero exit
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger().error(`Unexpected error: ${errorMessage}`);
  return null;
}

// PATTERN: the recovery recipe (research §4) — rootless omits -p
export function formatCommitRecoveryRecipe(a: {message:string; treeSha:string; parentSha?:string; newSha:string; error?:string;}): string {
  const parentArg = a.parentSha ? `-p ${a.parentSha} ` : '';
  return ['Smart Commit CAS refused (HEAD moved during message generation) — MUST NOT force.',
    '  The snapshotted work is safe as a dangling commit; HEAD is byte-for-byte unchanged.',
    `  treeSha:    ${a.treeSha}`,
    a.parentSha ? `  parentSha:  ${a.parentSha}` : '  parentSha:  (rootless repository — root commit)',
    `  newSha:     ${a.newSha}`, `  message:    ${JSON.stringify(a.message)}`,
    a.error ? `  git error:  ${a.error}` : null,
    '  Manual recovery (review the message above, then run):',
    `    git commit-tree ${parentArg}-m "<msg>" ${a.treeSha} | xargs git update-ref HEAD`,
  ].filter(Boolean).join('\n');
}

// GOTCHA (above): the catch re-throw is mandatory — without it the CAS refusal is swallowed to null.
// GOTCHA (above): return newSha (commitTreeResult.commitSha), not a gitCommit commitHash.
// GOTCHA (above): every happy-path test must migrate to mockGitCommitTree + mockGitUpdateRefCAS.
```

### Integration Points
```yaml
IMPORTS (src/utils/git-commit.ts):
  - add: gitCommitTree, gitUpdateRefCAS (from '../tools/git-mcp.js')
  - add: CommitCasRefusedError (from './errors.js')

NEW SYMBOLS:
  - src/utils/errors.ts: "export class CommitCasRefusedError extends PipelineError"   # mirrors AgentError
  - src/utils/git-commit.ts: "export function formatCommitRecoveryRecipe(...)"        # pure helper

SMARTCOMMIT CHANGE (replace the gitCommit block):
  - gitCommitTree({repoPath, treeSha, message, parentSha}) → newSha (parentSha undefined → root commit)
  - gitUpdateRefCAS({repoPath, newSha, expectedOldSha: parentSha}) (undefined → unconditional advance)
  - {success:false, casFailure:true} → throw CommitCasRefusedError (catch re-throws → non-zero exit)
  - success → return newSha

REMOVED FROM SMARTCOMMIT:
  - the `gitCommit({path, message})` call + its `commitResult.commitHash ?? null` path (replaced by plumbing)

DOWNSTREAM CONSUMERS (NOT this task — S3 reuses the surface):
  - P1.M1.T3.S3: the SIGINT/timeout rescue reuses treeSha + the manual recovery command.

NONE OF: the message-gen/retry/fallback block, formatCommitMessage, S1's capture, staging, restore_critical_files,
         the smartCommit signature, the plumbing primitives themselves (T1.S2/S3), PRD.md, spec/**, **/tasks.json.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run typecheck        # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint             # eslint . --ext .ts — clean
npm run format:check     # prettier — clean (run `npm run format` if it flags)
# Expected: zero errors.
```

### Level 2: Unit Tests (the PRIMARY gate)
```bash
npm run test:run -- git-commit
# EXPECTED: GREEN. ~10 migrated happy-path sites pass via mockGitCommitTree + mockGitUpdateRefCAS; the new
#   commit-tree-fails/CAS-refusal/rootless/fallback-plumbing tests pass; early-return tests unchanged.
# If a happy-path test regresses to null: a mockGitCommit site was missed (grep-gate below) OR the shared
#   beforeEach defaults are missing. If the CAS-refusal test gets null instead of a throw: the outer catch
#   is not re-throwing CommitCasRefusedError (the #2 trap).
# Grep-gate: confirm NO happy-path site still mocks gitCommit for the commit step.
grep -nE "mockGitCommit\.mockResolvedValue" tests/unit/utils/git-commit.test.ts | grep -iE "commitHash" || echo "OK: no commitHash-mocking happy-path sites remain"
```

### Level 3: Integration Testing (System Validation)
```bash
# Confirm gitCommit is gone from smartCommit; the plumbing pair is in; the catch re-throws.
grep -nE "gitCommitTree|gitUpdateRefCAS|CommitCasRefusedError|gitCommit\(" src/utils/git-commit.ts
# Expected: gitCommitTree + gitUpdateRefCAS present; CommitCasRefusedError thrown AND re-thrown in catch;
#   NO `await gitCommit(` remains in smartCommit (gitCommit import may remain if used elsewhere — check the
#   smartCommit body specifically).
grep -nE "await gitCommit\(" src/utils/git-commit.ts || echo "OK: smartCommit no longer calls gitCommit"
# Confirm identity transparency: no new identity-injection literals.
grep -nE "user\.name|user\.email|GIT_AUTHOR_|GIT_COMMITTER_" src/utils/git-commit.ts | grep -v '//' || echo "OK: no identity literals"
git status --porcelain | grep -E '^\s*[AM]\s+(PRD\.md|spec/|.*tasks\.json|prd_snapshot)' \
  && echo "VIOLATION: out-of-scope file touched" || echo "OK: no PRD/spec/tasks files modified"
```

### Level 4: Creative & Domain-Specific Validation
```bash
# Manual atomic-commit proof on a throwaway repo (no agent/LLM): write-tree → commit-tree → CAS advances HEAD.
npx tsx -e "
import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { gitWriteTree, gitCommitTree, gitUpdateRefCAS } from './src/tools/git-mcp.js';
const t = mkdtempSync(join(tmpdir(),'cas-')); const { simpleGit } = await import('simple-git');
const g = (await import('simple-git')).default(t); await g.init(); await g.add('.'); await g.commit('init');
writeFileSync(join(t,'f.txt'),'v2'); await g.add('.');
const parent = (await g.raw(['rev-parse','HEAD'])).trim();
const tree = (await gitWriteTree(t)).treeSha;
const ct = await gitCommitTree({repoPath:t, treeSha:tree, message:'1.1: atomic proof', parentSha:parent});
console.log('commit-tree:', JSON.stringify(ct));
const cas = await gitUpdateRefCAS({repoPath:t, newSha:ct.commitSha, expectedOldSha:parent});
console.log('cas:', JSON.stringify(cas));
console.log('HEAD now:', (await g.raw(['rev-parse','HEAD'])).trim(), '=== newSha?', (await g.raw(['rev-parse','HEAD'])).trim()===ct.commitSha);
"
# Expected: commit-tree {success:true, commitSha:<40>}; cas {success:true}; HEAD === newSha (atomic advance).
#   (The CAS-refusal THROW behavior is proven by the Level-2 rejects.toThrow test, which mocks update-ref → casFailure.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 typecheck/lint/format:check clean.
- [ ] Level 2 `npm run test:run -- git-commit` GREEN (~10 migrated + ~4 new; early-return unchanged).
- [ ] Level 3 grep confirms gitCommit gone from smartCommit; plumbing pair + re-throw present; no identity literals.
- [ ] Level 4 atomic proof: write-tree → commit-tree → CAS advances HEAD on a real repo.

### Feature Validation
- [ ] `gitCommitTree` + `gitUpdateRefCAS` replace `gitCommit`; success returns the `commitSha`.
- [ ] commit-tree `{success:false}` → log + return null (never-fail); update-ref not called.
- [ ] CAS `{success:false, casFailure:true}` → logs recovery recipe + throws `CommitCasRefusedError`; catch re-throws → non-zero exit (rejects.toThrow test).
- [ ] Rootless (`parentSha === undefined`): root commit (no -p) + unconditional update-ref advance.
- [ ] Fallback placeholder message flows through the plumbing commit (test asserts gitCommitTree called with the placeholder).
- [ ] Recovery recipe contains treeSha/parentSha(or rootless note)/newSha/message + the `git commit-tree … | xargs git update-ref HEAD` command.

### Code Quality Validation
- [ ] `CommitCasRefusedError extends PipelineError` mirrors AgentError exactly; `formatCommitRecoveryRecipe` is a pure exported helper.
- [ ] Outer catch re-throws the CAS refusal (narrow never-fail exception); all other failures still return null.
- [ ] No new git subprocess / identity injection in git-commit.ts (uses the wrappers; inherits repo config).
- [ ] smartCommit + helper JSDoc cite §5.1 snapshot-based atomic commit + the CAS-refusal edge case + non-zero exit.
- [ ] Edits located by grep (gitCommit block / outer catch), not stale line numbers.

### Documentation & Deployment
- [ ] No docs files in this task (Mode-B sweep is P3 — separate milestone).
- [ ] No env-var / config additions.

---

## Anti-Patterns to Avoid
- ❌ Don't swallow the CAS refusal into `null` — the outer catch MUST re-throw `CommitCasRefusedError` or §5.1's "exits non-zero" is defeated (the #2 trap). Forcing the advance is strictly forbidden.
- ❌ Don't miss a `mockGitCommit.mockResolvedValue` site — every happy-path test must migrate to `mockGitCommitTree` + `mockGitUpdateRefCAS` or it regresses to null (the #1 trap). Grep-gate at the end.
- ❌ Don't add a separate `gitCommit` for the fallback path — the placeholder message converges on `formattedMessage` and flows through the SAME plumbing commit. Verify with a test.
- ❌ Don't treat `parentSha === undefined` as an error — pass it through (root commit / unconditional advance). Same for `expectedOldSha`.
- ❌ Don't return a `gitCommit` `commitHash` — return `gitCommitTree`'s `commitSha` (`newSha`).
- ❌ Don't touch the message-gen/retry/fallback block, `formatCommitMessage`, S1's capture, staging, or the signature — only the commit block + outer catch + helper + error class + JSDoc.
- ❌ Don't invent a new error base — `CommitCasRefusedError extends PipelineError`, mirroring `AgentError` verbatim.
- ❌ Don't trust line numbers (S1 + T2.S1 shift them) — grep for `await gitCommit({` and the outer `} catch (error) {`.
- ❌ Don't run the full TS test suite and treat unrelated pre-existing diagnostics as this task's failure — run the targeted `git-commit` suite (Level 2).

---

## Confidence Score
**8 / 10** — one-pass success. The code change is small and copy-ready (replace one block + a catch
re-throw + a pure helper + a PipelineError subclass). The main residual risks are (a) the ~10-site test
migration — mitigated by the shared-beforeEach defaults + the grep-gate; (b) the catch re-throw being
forgotten — mitigated by the explicit rejects.toThrow test that fails if the CAS refusal is swallowed.
Identity transparency is inherited (no new git subprocess in git-commit.ts). The §5.1 "MUST NOT force /
exits non-zero" mandate is the load-bearing design decision and is mechanically enforced by the typed
throw + re-throw.