# Research Note — P1.M1.T3.S2: Post-generation commit-tree + CAS update-ref, edge-case handling

## 0. Predecessor contract (S1, being implemented — read as TRUTH)

S1 inserts the **pre-generation** capture after `await restore_critical_files(repoRoot);` in `smartCommit`
(`src/utils/git-commit.ts`):
- `const headResult = await gitRevParseHead(repoRoot);` → `parentSha = headResult.success ? headResult.sha : undefined;` (undefined = rootless → root commit).
- `const treeResult = await gitWriteTree(repoRoot);` → `treeSha = treeResult.treeSha`; on `{success:false}` → log + `return null` (conflict fail-fast).
- S1 leaves the **existing message-gen + `gitCommit` block UNCHANGED** — that block is what S2 replaces.
- S1 also added `gitWriteTree` + `gitRevParseHead` to the test mock factory + shared `beforeEach` success defaults (so all existing smartCommit tests stay green).

So at S2 execution time: `parentSha` (string|undefined) + `treeSha` (string) are locals in smartCommit,
already captured; the test file already mocks gitWriteTree/gitRevParseHead. S2 consumes the two locals.

## 1. The plumbing primitives (T1.S2/T1.S3 — Complete, in src/tools/git-mcp.ts)

### gitCommitTree (L651-693)
```ts
type GitCommitTreeResult =
  | { success: true; commitSha: string }
  | { success: false; error: string };

async function gitCommitTree(input: {
  treeSha: string; message: string; parentSha?: string; repoPath?: string;
}): Promise<GitCommitTreeResult>
```
- `parentSha` OPTIONAL → when omitted, no `-p` is passed (root commit / rootless repo). Argv vector
  (`['commit-tree', treeSha, ...parent, '-m', message]`), no shell. `message` is the `-m` argv element
  (execFile preserves embedded newlines → multi-line body verbatim). Returns trimmed 40-char commitSha.
- `{success:false}` carries the git error message (bad tree/parent SHA, git internal) — NOT re-thrown.

### gitUpdateRefCAS (L720-782)
```ts
type GitUpdateRefCASResult =
  | { success: true }
  | { success: false; error: string; casFailure: true };

async function gitUpdateRefCAS(input: {
  newSha: string; expectedOldSha?: string; repoPath?: string;
}): Promise<GitUpdateRefCASResult>
```
- `expectedOldSha` OPTIONAL → when omitted, no expected-old positional (unconditional advance — rootless).
  Args: `['update-ref', 'HEAD', newSha, ...(expectedOldSha ? [expectedOldSha] : [])]`. **SILENT** on success.
- `{success:false}` ALWAYS has `casFailure:true` (HEAD moved during generation, bad newSha, or git error).
  **HEAD is byte-for-byte unchanged on failure. MUST NOT force** (no `--force`, no retry-without-expected-old,
  no fallback `git commit`). The dangling commit + tree from steps 1-2 remain (reaped by `git gc`).

**S2 imports** `gitCommitTree` + `gitUpdateRefCAS` into git-commit.ts (add to the existing `import { … } from '../tools/git-mcp.js';`).

## 2. The block S2 replaces (src/utils/git-commit.ts, current L727-740)

```ts
    // Create commit
    const commitResult = await gitCommit({
      path: repoRoot,
      message: formattedMessage,
    });

    if (!commitResult.success) {
      logger().error(`Git commit failed: ${commitResult.error}`);
      return null;
    }

    // Return commit hash
    const commitHash = commitResult.commitHash ?? null;
    logger().info(`Commit created: ${commitHash}`);
    return commitHash;
```
This is the **only** block S2 changes in the happy/fallback path. The message-resolution block above it
(`generateCommitMessage` retry → `formatCommitMessage`, OR `buildFallbackCommitMessage` fallback →
`formatCommitMessage`) is UNCHANGED — `formattedMessage` is produced identically; S2 just feeds it to
plumbing instead of `gitCommit`. (The fallback path ALSO uses plumbing — item requirement: "on fallback,
use the PLUMBING commit with the placeholder message, not simple-git's git.commit()". Since both paths
converge on `formattedMessage` then the same commit block, this is automatic.)

## 3. The replacement (after S2)

```ts
    // Snapshot-based atomic commit (PRD §5.1): commit-tree (dangling) → CAS update-ref.
    // Replaces the simple-git gitCommit. parentSha + treeSha captured pre-generation (S1).
    const commitTreeResult = await gitCommitTree({
      repoPath: repoRoot,
      treeSha,
      message: formattedMessage,
      parentSha, // undefined for a rootless repo → root commit (no -p)
    });
    if (!commitTreeResult.success) {
      // commit-tree failed (bad tree/parent SHA, git internal). Never-fail contract: log + null.
      // HEAD/index byte-for-byte unchanged; the dangling tree from S1 remains (git gc reaps it).
      logger().error(`commit-tree failed: ${commitTreeResult.error}`);
      return null;
    }
    const newSha = commitTreeResult.commitSha;

    // CAS advance: atomically move HEAD only if it still equals parentSha.
    const casResult = await gitUpdateRefCAS({
      repoPath: repoRoot,
      newSha,
      expectedOldSha: parentSha, // omitted (rootless) → unconditional advance
    });
    if (!casResult.success) {
      // §5.1 "HEAD moved during generation": CAS refused. MUST NOT force. Surface the generated
      // message + a manual recovery recipe and exit non-zero (narrow exception to the never-fail
      // contract — forcing would silently clobber a concurrent commit).
      const recipe = formatCommitRecoveryRecipe({
        message: formattedMessage, treeSha, parentSha, newSha, error: casResult.error,
      });
      logger().error(recipe);
      throw new CommitCasRefusedError(recipe, { treeSha, parentSha, newSha });
    }

    logger().info(`Commit created: ${newSha}`);
    return newSha;
```

### The never-fail catch MUST re-throw the CAS refusal
The current outer `catch (error) { … return null; }` (L741) swallows EVERY throw → null. For the CAS
refusal to exit non-zero (§5.1 + item requirement), the catch must re-throw it:
```ts
  } catch (error) {
    // Safety-critical narrow exception (§5.1): a CAS refusal (HEAD moved during generation) MUST
    // propagate so the process exits non-zero and a human sees the recovery recipe — NOT swallowed.
    if (error instanceof CommitCasRefusedError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger().error(`Unexpected error: ${errorMessage}`);
    return null;
  }
```
All other failures still return null (never-fail). smartCommit's return type stays `string | null`; it now
ALSO throws `CommitCasRefusedError` (documented in JSDoc).

## 4. The recovery-recipe helper (NEW) + the typed error (NEW)

```ts
/**
 * Format the §5.1 "HEAD moved during generation" manual-recovery recipe (CAS refusal).
 * @remarks ...cites §5.1 edge case: MUST NOT force; surfaces message + recipe; exits non-zero.
 */
export function formatCommitRecoveryRecipe(args: {
  message: string; treeSha: string; parentSha?: string; newSha: string; error?: string;
}): string {
  const parentArg = args.parentSha ? `-p ${args.parentSha} ` : '';
  return [
    'Smart Commit CAS refused (HEAD moved during message generation) — MUST NOT force.',
    '  The snapshotted work is safe as a dangling commit; HEAD is byte-for-byte unchanged.',
    `  treeSha:    ${args.treeSha}`,
    args.parentSha
      ? `  parentSha:  ${args.parentSha}`
      : '  parentSha:  (rootless repository — root commit)',
    `  newSha:     ${args.newSha}`,
    `  message:    ${JSON.stringify(args.message)}`,
    args.error ? `  git error:  ${args.error}` : null,
    '  Manual recovery (review the message above, then run):',
    `    git commit-tree ${parentArg}-m "<msg>" ${args.treeSha} | xargs git update-ref HEAD`,
  ].filter(Boolean).join('\n');
}
```
(The `-m "<msg>"` is faithful to the item's command; the verbatim message is logged via JSON.stringify so
the human can paste/escape it. Rootless → omits `-p <PARENT_SHA>`.)

### CommitCasRefusedError — follow the PipelineError convention
`src/utils/errors.ts` defines `abstract class PipelineError extends Error` (L145, constructor
`(message, context?, cause?)`) with subclasses `SessionError`/`TaskError`/`AgentError`. Add a sibling:
```ts
export class CommitCasRefusedError extends PipelineError {
  constructor(message: string, context?: PipelineErrorContext, cause?: Error) {
    super(message, context, cause);
  }
}
```
(mirror `AgentError` at L422-425 exactly — same constructor shape; do NOT invent a new base). This makes
the orchestrator's existing `main().catch` (which handles `PipelineError` → non-zero exit) propagate it
naturally. Alternative (lower-scope): define it locally in git-commit.ts — but errors.ts is the
established home for PipelineError subclasses and keeps the `instanceof` check importable by callers.
Recommend errors.ts.

## 5. Test strategy — the BIG migration (the #1 trap)

### The mock migration
The mock factory (tests/unit/utils/git-commit.test.ts L20-29) currently has `gitCommit: vi.fn()`. After S2,
smartCommit calls `gitCommitTree` + `gitUpdateRefCAS` INSTEAD of `gitCommit`. So:
- ADD `gitCommitTree: vi.fn()` + `gitUpdateRefCAS: vi.fn()` to the factory (L20-29) + import (L65) +
  `const mockGitCommitTree = vi.mocked(...)` / `const mockGitUpdateRefCAS = vi.mocked(...)` (L90-97).
- SHARED `beforeEach` (L114+): default BOTH to success —
  `mockGitCommitTree.mockResolvedValue({success:true, commitSha:'new-sha-0001'})` +
  `mockGitUpdateRefCAS.mockResolvedValue({success:true})`. (S1 already defaulted gitWriteTree/gitRevParseHead
  there; S2 adds these two.) This keeps every existing happy-path test green via the new path.

### Existing tests to MIGRATE (every site that mocks/asserts gitCommit)
~8-10 sites assert `mockGitCommit.mockResolvedValue({success:true, commitHash:'abc123…'})` + return a hash.
Each must switch its commit-creation mock to the plumbing pair:
- `mockGitCommit.mockResolvedValue({success:true, commitHash:'abc123'})` →
  `mockGitCommitTree.mockResolvedValue({success:true, commitSha:'abc123'})` + `mockGitUpdateRefCAS.mockResolvedValue({success:true})`.
- `expect(mockGitCommit).toHaveBeenCalledWith({path: repoRoot, message: …})` →
  `expect(mockGitCommitTree).toHaveBeenCalledWith({repoPath: repoRoot, treeSha, message: …, parentSha: 'parent-sha-0001'})` +
  `expect(mockGitUpdateRefCAS).toHaveBeenCalledWith({repoPath: repoRoot, newSha: 'abc123', expectedOldSha: 'parent-sha-0001'})`.
  (parentSha/treeSha are the S1 shared-defaults 'parent-sha-0001'/'tree-sha-0001' — use those literals.)

Sites (by `mockGitCommit`/`commitHash` line): L482, L514, L659, L684-697 (see below), L713, L786, L810,
L833, L857, L1260.

### Early-return tests — NO change needed
`expect(mockGitCommit).not.toHaveBeenCalled()` at L544, L559, L627, L646 assert smartCommit returns
BEFORE the commit (status empty / gitAdd fails / etc.). After S2, `gitCommit` is never called AND
`gitCommitTree` is never called either → these `not.toHaveBeenCalled()` assertions stay TRUE. Leave them.

### The "no commitHash → null" test (L684-697) — REFRAME
Today: `gitCommit {success:true}` omits `commitHash` → `commitHash ?? null` → null. After S2 this premise
is gone (gitCommitTree always returns `commitSha` on success). Reframe this test to a real S2 failure:
**commit-tree fails → null** (`mockGitCommitTree.mockResolvedValue({success:false, error:'bad tree'})` →
smartCommit returns null, `mockGitUpdateRefCAS` not called).

### NEW tests (S2-specific)
1. **commit-tree fails → null**: `mockGitCommitTree` → `{success:false, error}`, smartCommit returns null,
   `mockGitUpdateRefCAS` not called. (replaces/adjacent to the reframed L684 test.)
2. **CAS refusal → throws + logs recipe**: `mockGitUpdateRefCAS` → `{success:false, error:'…',
   casFailure:true}`, `await expect(smartCommit(...)).rejects.toThrow(CommitCasRefusedError)`, and assert
   the recovery recipe was logged (spy on logger.error → contains the `git commit-tree … | xargs git
   update-ref HEAD` command + the treeSha/parentSha/newSha). **Proves the never-fail exception.**
3. **rootless repo → root commit path**: S1's gitRevParseHead default → parentSha undefined; assert
   `mockGitCommitTree` called with `parentSha: undefined` (no -p) AND `mockGitUpdateRefCAS` called with
   `expectedOldSha: undefined` (unconditional advance). (Override gitRevParseHead → {success:false} for this test.)
4. **fallback path uses plumbing**: generateCommitMessage fails (mock the agent to throw / AgentError) →
   buildFallbackCommitMessage placeholder → assert `mockGitCommitTree` called with the PLACEHOLDER message
   (not gitCommit). Confirms the item's "fallback uses the plumbing commit."
5. (Optional) **happy path returns the commitSha**: `mockGitCommitTree` → `{success:true, commitSha:'XYZ'}`
   + CAS success → smartCommit returns `'XYZ'` (the migrated happy-path tests cover this, but an explicit
   assertion that the return === commitTreeResult.commitSha, not a gitCommit hash, is worth one test).

### generateCommitMessage tests (L915+) — UNCHANGED
Those test `generateCommitMessage` directly (rejects.toThrow(AgentError)), not smartCommit. They don't
touch the commit block. Leave them.

## 6. JSDoc (Mode A — item requirement)

- **smartCommit JSDoc**: ADD bullets — (1) §5.1 snapshot-based atomic commit: write-tree (S1) → message-gen →
  commit-tree (dangling) → CAS update-ref; HEAD advances atomically or not at all. (2) §5.1 edge case "HEAD
  moved during generation": CAS refuses; MUST NOT force; surfaces the message + a manual recovery recipe and
  exits non-zero (THROWS `CommitCasRefusedError` — narrow exception to the never-fail contract). (3) returns
  the commit SHA (string) on success, null on non-CAS failures. Update `@returns` to note it can throw.
- **formatCommitRecoveryRecipe JSDoc**: cite §5.1 "HEAD moved during generation — CAS update-ref fails;
  MUST NOT force. Surfaces generated message + manual recovery recipe and exits non-zero."

## 7. Validation commands (verified in package.json)
```bash
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — exit 0
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
npm run test:run -- git-commit   # the targeted suite (95 it() today; ~10 migrated + ~4 new)
```

## 8. Risk assessment
- **Medium.** The wiring itself is small (replace ~14 lines + a catch re-throw + a helper + an error class).
  The risk is the TEST MIGRATION (~10 sites must switch gitCommit→gitCommitTree+gitUpdateRefCAS, plus shared
  defaults) — the #1 trap, identical in spirit to S1's. The CAS-refusal throw interacting with the never-fail
  catch (must re-throw, not swallow) is the second trap. Mitigated by: shared-beforeEach defaults keep
  happy-path tests green; the grep-gate confirms no stray `mockGitCommit.mockResolvedValue` remains; the
  rejects.toThrow test proves the throw escapes smartCommit.
- **Confidence: 8/10.** Residual risks: a test site missed in the migration (grep-gated); the PipelineError
  subclass constructor signature differing from AgentError (mirror exactly); logger spy wiring for the recipe
  assertion. Identity transparency (no user.*/GIT_AUTHOR_*) is inherited from the plumbing primitives — no
  new git subprocess is added in git-commit.ts (it calls the wrappers), so no new identity surface.