# S1 Contract State — what P3.M2.T1.S1 already produced

> Verified by direct read of `src/core/tasks-json-recovery.ts` (current HEAD).
> **S1 is ALREADY IMPLEMENTED and landed.** This PRP (S2) only CONSUMES its output.

## What S1 added to `src/core/tasks-json-recovery.ts`

### 1. `RESEARCH_PRESERVE_STATUSES` constant (module-level)
```ts
const RESEARCH_PRESERVE_STATUSES = new Set<string>(['Researching', 'Ready']);
```

### 2. `snapshotResearchingReadyIds(tasksPath)` helper (module-private)
- Signature: `async function snapshotResearchingReadyIds(tasksPath: string): Promise<readonly string[]>`
- Reads the working-tree file with `readFile` (node:fs/promises) + `JSON.parse`, then does a
  **lenient DFS** over the `unknown` parsed value collecting every node with string `id` whose
  string `status` is in `RESEARCH_PRESERVE_STATUSES`.
- Wrapped in `try/catch` returning `[]` on any error. **Never throws.**
- Reads OUTSIDE the lock (pure best-effort read).

### 3. `TasksJsonRecoveryResult.preservedResearchingReadyIds: readonly string[]` field
- Always defined (never `undefined`).
- **PATH B (corrupt disk → git restore)**: populated from `snapshotResearchingReadyIds(tasksPath)`,
  captured BEFORE `gitFileHistory`. Present on BOTH PATH-B return sites (git-restore-success AND
  no-valid-version failure).
- **PATH A (clean disk)**: `[]` (no revert).
- **PATH C (outer catch / total failure)**: `[]`.

### 4. Current state of `recoverTasksJson` (post-S1, pre-S2)
- PATH A: `diskClean === true` → `withLockedTasksJSON` RMW applying ONLY `legitimateDelta`
  (the `{itemId, status}` the orchestrator intends). Returns `{restored:false, source:'disk',
  backlog, preservedResearchingReadyIds: []}`. **Does NOT consume the snapshot** (none needed —
  no revert).
- PATH B: `diskClean === false` → snapshot captured → `gitFileHistory` walk → restore last valid
  committed blob → `withLockedTasksJSON` RMW applying `legitimateDelta` onto restored base.
  Returns `{restored:true, source:'git', backlog, preservedResearchingReadyIds: snapshot}`.
  **Snapshot is captured but NOT YET re-applied.**
- PATH C (no valid version): returns `{restored:false, source:'disk', reason:'...no valid
  version in git history', preservedResearchingReadyIds: snapshot}`.
- PATH C (outer catch): returns `{restored:false, source:'disk', reason:'recovery failed: ...',
  preservedResearchingReadyIds: []}`.

## What S1 did NOT do (the S2 scope)
- S1 does NOT re-apply the snapshot statuses.
- S1 does NOT gate on filesystem evidence (PRP.md / research/ existence).
- S1 leaves PATH B's "Researching/Retrying items are preserved automatically (we mutate ONLY the
  target item)" comment — this incidental preservation covers the COMMITTED blob's statuses but
  NOT the supervisor's UNCOMMITTED writes. S2 explicitly re-applies the snapshot gated on FS
  evidence.

## The gap S2 closes
Without S2: if the research supervisor wrote `S3: Ready` to the working-tree file (uncommitted)
and an agent truncated the file, PATH B restores the last *committed* blob (where S3 is still
`Planned`), applies the legitimate delta, and returns the snapshot `['P1.M1.T1.S3']` — but
**nobody re-applies it**. S3 silently resets to `Planned`, orphaning the completed PRP/research.

S2: after the restore + legitimate-delta application, iterate the snapshot ids; for each id,
probe filesystem evidence; if `PRP.md` exists → `Ready`; elif `research/` dir exists →
`Researching`; else leave at the reverted status (`Planned`).