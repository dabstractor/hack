# Two-Phase Commit Design Notes (P3.M1.T3.S2)

## Source of truth
- PRD §4.2 (h3.4) step 4 — "Cleanup & Commit (two-phase commit)":
  - **Pre-cleanup commit (survival):** commit the item's substance (source
    changes, its `plan/` work dir, its `Complete` status) via `stagecoach`
    `smartCommit` BEFORE the cleanup agent runs. Reason: a force-interrupt
    during cleanup can no longer leave an item "Complete on disk but
    uncommitted" — the orphaning state. The cleanup agent is FORBIDDEN from
    touching `plan/` (§5.1).
  - **Cleanup:** temp artifacts removed; docs moved to `docs/`; `tasks.json`
    saved.
  - **Post-cleanup commit:** commit the cleanup agent's doc reorganization in a
    second `stagecoach` `smartCommit` call.
- PRD §5.1 (h3.9) "Orphaned-plan/ Recovery" — the pre-cleanup commit + the
  skip-recovery (P3.M2.T5.S1) together close the orphaning window.

## Current state (architecture/phase_findings.md §PHASE 3 + code)
- `executeSubtask` (task-orchestrator.ts:749) does ONE `smartCommit` AFTER
  `flushUpdates()` (lines 995-1030), guarded by `if (succeeded)`.
- No pre-cleanup commit, no cleanup-agent invocation, no post-cleanup commit.
- `smartCommit(sessionPath, message)` is single-phase, pre-formatted message.
- The single production caller is task-orchestrator.ts:1004.

## Dependency relationship
- **Consumes:** P3.M1.T3.S1 → `smartCommit(sessionPath, fallback, options?: { generateMessage?: boolean })`.
  The stagecoach path produces diff-accurate commit messages — REQUIRED because
  the two phases commit semantically different work (substance vs. doc
  reorg) and a fixed `"${id}: ${title}"` template would make them
  indistinguishable.
- **Provides seam for:** P3.M1.T3.S3 → the cleanup agent persona. S3 is
  Planned (not started). S2 MUST NOT import a non-existent persona. Solution:
  S2 defines an **injectable cleanup callable** (constructor option +
  interface) with a **no-op default**. S3 wires the real `createCleanupAgent`
  persona into that callable. S2's tests mock the callable.

## Design decisions

### 1. Stagecoach message generation per phase (consume S1)
- Pre-cleanup commit: `smartCommit(sessionPath, `${subtask.id}: ${subtask.title}`, { generateMessage: true })`.
  The fallback (`id: title`) preserves readability if generation fails; S1's
  `smartCommit` swallows generation errors and returns null (never throws),
  and when generation works the message describes the actual substance.
- Post-cleanup commit: `smartCommit(sessionPath, 'cleanup: doc reorganization', { generateMessage: true })`.
  Diff-accurate message describes the doc moves / temp removal.

### 2. Cleanup-agent seam (decouple from S3)
New module `src/core/cleanup-runner.ts` exports:
- `CleanupContext` interface: `{ sessionPath: string; subtask: Subtask; repoRoot: string }`
- `CleanupResult` interface: `{ success: boolean; summary?: string; error?: string }`
- `type CleanupRunner = (ctx: CleanupContext) => Promise<CleanupResult>`
- `createCleanupRunner(): CleanupRunner` — DEFAULT returns a no-op
  `{ success: true, summary: 'cleanup disabled (no persona wired)' }`.
  This lets S2 ship and test independently; S3 replaces the default with a
  real persona invocation.
- `TaskOrchestrator` constructor gains optional 2nd arg
  `{ cleanupRunner?: CleanupRunner }` stored on `#cleanupRunner` (default
  `createCleanupRunner()`). This mirrors the existing DI-light pattern (the
  class already takes `sessionManager` only — adding an options bag is
  non-breaking).

### 3. Failure handling — cleanup is best-effort, never fatal
- Per §5.1, cleanup is the interruptible long step. If `cleanupRunner` throws
  or returns `{ success: false }`: LOG at warn, **swallow** (do NOT fail the
  subtask — the survival commit already persisted the substance + Complete
  status). The post-cleanup commit is SKIPPED (nothing to commit). The
  subtask still succeeds. This preserves the §4.2 invariant: an interrupt
  during cleanup cannot lose the item.

### 4. Ordering inside `if (succeeded)` block (replace single smartCommit)
```
flushUpdates()                          // existing — persists Complete status
// ---- PHASE 1: survival commit ----
preHash = smartCommit(sessionPath, fallback, { generateMessage: true })
// ---- cleanup (best-effort, isolated) ----
try { res = await #cleanupRunner({sessionPath, subtask, repoRoot}) }
catch(e){ res = {success:false, error:...} }
flushUpdates()                          // cleanup may have written tasks.json
// ---- PHASE 2: post-cleanup commit (only if cleanup changed something) ----
if (res.success) postHash = smartCommit(sessionPath, 'cleanup: doc reorganization', { generateMessage: true })
```

## Validation approach
- Unit: mock `smartCommit` (assert 2 calls with `generateMessage:true`), mock
  `cleanupRunner` injected via constructor (assert invoked with correct ctx,
  assert subtask succeeds even when cleanup throws).
- Existing tests: the existing "smartCommit integration" block
  (task-orchestrator.test.ts:834) asserts `smartCommit` called with
  `(path, 'P1.M1.T1.S1: Test Subtask')` — MUST be UPDATED to the 3-arg
  generateMessage form. This is expected churn, not a regression.