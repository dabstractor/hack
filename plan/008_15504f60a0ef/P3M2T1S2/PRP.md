# PRP — P3.M2.T1.S2: Re-apply statuses gated on filesystem evidence

---

## Goal

**Feature Goal**: **Consume** the pre-revert snapshot produced by sibling
**P3.M2.T1.S1** (the `preservedResearchingReadyIds: readonly string[]` field on
`TasksJsonRecoveryResult`) and **re-apply each snapshotted id's status gated on
filesystem evidence** — `Ready` only if the item's PRP file exists, `Researching`
only if its `research/` directory exists — **inside the same locked
read-modify-write** that PATH B of `recoverTasksJson`
(`src/core/tasks-json-recovery.ts`) already performs after the git-history
restore. This completes PRD §5.1's *"Preserve background-research status
(snapshot before revert)"* contract and the work item's LOGIC/OUTPUT
requirements.

> **CRITICAL CONTEXT — S1 IS ALREADY IMPLEMENTED AND LANDED.** Verified by
> reading the current `src/core/tasks-json-recovery.ts`: the
> `snapshotResearchingReadyIds(tasksPath)` helper, the
> `RESEARCH_PRESERVE_STATUSES` constant, the
> `TasksJsonRecoveryResult.preservedResearchingReadyIds` field, and the PATH-B
> capture-before-`gitFileHistory` wiring all already exist. S2 is **purely the
> consumer side**: it does NOT re-implement the snapshot, it CONSUMES the
> snapshot that PATH B already captures and returns. Do not duplicate the
> snapshot logic — read `result.preservedResearchingReadyIds`.

**Deliverable** (2 files: 1 modified production utility + 1 modified test):
1. **`src/core/tasks-json-recovery.ts`** — MODIFY:
   - Add a module-private `resolveResearchStatus(itemId, sessionDir):
     Promise<Status | null>` helper that probes filesystem evidence for an item
     id and returns the status to re-apply (or `null` to leave the reverted
     status). Never throws.
   - In PATH B's `withLockedTasksJSON` mutator, **after** the existing
     `setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)`,
     iterate `preservedResearchingReadyIds` (skipping
     `legitimateDelta.itemId`), probe FS evidence, and re-apply `Ready`/`
     Researching` via `setItemStatus`.
   - Update the `recoverTasksJson` JSDoc to document the snapshot-before-revert
     + FS-evidence-gating logic (work item DOCS contract, Mode A — rides with
     the work). Fix the stale "Researching/Retrying items are preserved
     automatically (we mutate ONLY the target item)" PATH-B comment to reflect
     the new explicit re-apply.
   - **No new exported symbols. No config/env surface. No PATH A / PATH C
     changes** (PATH A snapshot is `[]`; PATH C has no restored backlog to
     re-apply onto).
2. **`tests/unit/core/tasks-json-recovery.test.ts`** — MODIFY/ADD: add ~7 tests
   covering (a) Ready re-applied when PRP.md exists (per-item-dir layout), (b)
   Ready re-applied from runtime `prps/{sanitizedId}.md` layout, (c) Researching
   re-applied when `research/` dir exists, (d) item left at reverted status when
   NEITHER exists, (e) legitimate-delta id takes precedence (snapshot skip), (f)
   PATH A/C unchanged, (g) stray-file-named-`research` does not flip to
   Researching.

**Scope note (critical):** This task is **ONLY the FS-evidence-gated re-apply of
the snapshot that S1 already captures**. It does NOT touch the snapshot helper,
the snapshot capture, the result interface field, PATH A, PATH C, the git-walk,
`file-lock.ts`, `task-utils.ts`, `models.ts`, `state-validator.ts`,
`session-utils.ts`, `git-mcp.ts`, or `task-orchestrator.ts` (the caller already
picks up `recovery.backlog`, which will now carry the re-applied statuses — no
caller change needed). It COMPLETES P3.M2.T1.

**Success Definition**:
- After a PATH-B git restore, an item that was `Ready` in the working-tree
  snapshot is set back to `Ready` ONLY if its PRP file exists on disk; to
  `Researching` ONLY if its `research/` directory exists; otherwise left at the
  reverted (committed-blob) status.
- The re-apply runs **inside the same locked RMW** as the legitimate-delta
  application (no second lock acquisition, no inter-write lost-update window).
- The legitimate delta (the item just implemented/interrupted) takes precedence:
  a snapshotted id equal to `legitimateDelta.itemId` is NOT re-applied.
- The existing "PATH B — preserves Researching status across a git restore"
  test STILL passes (its working-tree snapshot is `[]` because the file is fully
  corrupted → S2 re-applies nothing → committed Researching preserved by the
  restore write).
- `npm run validate` GREEN; **100% coverage** on
  `src/core/tasks-json-recovery.ts` maintained.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline's background research supervisor
(P3.M1.T1 — the depth-chained `ResearchQueue` in `src/core/research-queue.ts`)
and the orchestrator's `recoverTasksJson` routine. No human in the loop.
**Use Case**: The background supervisor flips a subtask to `Ready` (PRP written
to disk) or `Researching` (research dir in flight) in the working-tree
`tasks.json`. A Coder agent then corrupts the file (truncated write). Without
S2, PATH B restores the last *committed* blob (which does NOT carry the
supervisor's uncommitted `Ready`/`Researching` write), S1's snapshot sits in
`result.preservedResearchingReadyIds` UNUSED, and the research status is lost —
the supervisor's PRP/research work is orphaned and the item incorrectly resets
to `Planned`. S2 closes the loop: it reads the snapshot and re-applies the
status gated on the actual PRP/research artifacts on disk.
**User Journey**: orchestrator runs agent → agent corrupts `tasks.json` →
`recoverTasksJson` PATH B → S1 snapshots `Researching`/`Ready` ids from working
tree → `gitFileHistory` walk → restore last valid committed blob → **[NEW, S2]
inside locked RMW: apply legitimate delta, then for each snapshotted id probe
FS evidence and re-apply `Ready`/`Researching`** → return `{restored:true,
backlog, preservedResearchingReadyIds}` → caller (`task-orchestrator.ts`)
reuses `recovery.backlog` (now carrying re-applied statuses).
**Pain Points Addressed**: PRD §5.1 line 187 — *"Items marked `Researching` or
`Ready` by the background research queue must survive a restore. To do this
reliably, the restore logic snapshots the live `Researching`/`Ready` item IDs
from the working-tree `tasks.json` before the git revert, then re-applies them
afterward gated on filesystem evidence: an item is set back to `Ready` only if
its `PRP.md` exists, and to `Researching` only if its `research/` directory
exists. This must not depend on an in-memory index that can drift out of sync
with the supervisor."*

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) *"Preserve background-research status
  (snapshot before revert)"* mandates that the snapshot be **re-applied** after
  the restore, gated on **filesystem evidence** (PRP.md existence → `Ready`;
  research/ directory existence → `Researching`). S1 shipped the snapshot
  capture; S2 ships the re-apply. Without S2 the snapshot is dead data and the
  PRD contract is unfulfilled.
- **Contract item 3 (LOGIC)**: *"After the git revert restores a baseline
  tasks.json, iterate the snapshotted Researching/Ready IDs: (a) For each ID,
  check filesystem evidence: if `join(sessionPath, itemId, 'PRP.md')` exists (or
  the PRP path pattern used by the codebase) → set status to 'Ready'; if
  `join(sessionPath, itemId, 'research/')` exists → set status to 'Researching'.
  (b) If neither exists, leave the item at its reverted status (likely
  'Planned'). (c) This replaces the current approach of preserving items purely
  by only-mutating-the-target-item; now we explicitly snapshot + re-apply with
  FS gating."* → implemented as `resolveResearchStatus(itemId, sessionDir)` +
  a re-apply loop inside PATH B's locked mutator.
- **Contract item 4 (OUTPUT)**: *"FS-evidence-gated status re-application in
  `recoverTasksJson`. Completes P3.M2.T1."*
- **Contract item 5 (DOCS, Mode A)**: *"JSDoc on `recoverTasksJson` documenting
  the snapshot-before-revert + FS-evidence-gating logic. This rides WITH the
  work."* → update the `recoverTasksJson` JSDoc + the PATH-B inline comment.
- **Why FS-gating instead of trusting the snapshot status**: A snapshot taken
  from a corrupt-by-construction working-tree file could carry a stale status
  (e.g. an item the supervisor marked `Ready` but whose PRP was later deleted by
  a cleanup). The PRD mandates FS evidence as the *authoritative* signal — if
  the PRP isn't on disk, the item is NOT `Ready`. This prevents resurrecting a
  `Ready`/`Researching` status for work that no longer exists on disk.
- **Why inside the locked RMW (not the caller)**: PRD §5.1 says *"the restore
  logic snapshots … then re-applies them afterward"* — the restore logic IS
  `recoverTasksJson`. Doing the re-apply in a second locked write in the caller
  (`task-orchestrator.ts`) would open a lost-update window between the restore
  write and the re-apply (the supervisor could land a fresh `Ready` in between
  and we'd clobber it by reading a stale snapshot). Re-applying in the SAME
  `withLockedTasksJSON` mutator as the legitimate delta is serialized with the
  restore write and needs no second lock. See research/03-integration-design.md.

---

## What

One modified production utility (`tasks-json-recovery.ts`), one modified test
(`tasks-json-recovery.test.ts`). **No** config, **no** new files, **no** new
dependencies, **no** caller changes.

### Success Criteria

- [ ] **A module-private helper `resolveResearchStatus(itemId: string,
      sessionDir: string): Promise<Status | null>` exists** in
      `tasks-json-recovery.ts`. It probes BOTH PRP-path layouts (per-item-dir
      `{sanitizedId}/PRP.md` AND runtime `prps/{sanitizedId}.md`) and the
      per-item-dir `research/` directory; returns `'Ready'` if any PRP candidate
      exists, `'Researching'` if `research/` exists as a DIRECTORY, `null` if
      neither. It NEVER throws (best-effort `stat`, `false` on any error).
- [ ] **PATH B's `withLockedTasksJSON` mutator re-applies the snapshot**:
      immediately AFTER the existing
      `setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)`,
      iterate `preservedResearchingReadyIds`; for each `id !== legitimateDelta.itemId`,
      `const status = await resolveResearchStatus(id, sessionDir); if (status) setItemStatus(target, id, status);`.
- [ ] **The legitimate delta takes precedence**: a snapshotted id equal to
      `legitimateDelta.itemId` is skipped (not re-applied), so an item the
      orchestrator just completed is not reverted to `Ready`/`Researching`.
- [ ] **PATH A is unchanged**: it returns `preservedResearchingReadyIds: []` and
      does NOT re-apply (no revert → supervisor's statuses already on disk).
- [ ] **PATH C is unchanged**: the no-valid-version site returns
      `preservedResearchingReadyIds: snapshot` (for observability) but writes
      NOTHING (no restored backlog to re-apply onto); the outer-catch site
      returns `[]`.
- [ ] **The `recoverTasksJson` JSDoc documents the snapshot + FS-gating logic**
      (Mode A docs, riding with the work). The stale PATH-B comment
      *"Researching/Retrying items are preserved automatically (we mutate ONLY
      the target item)"* is corrected to reflect the explicit snapshot re-apply.
- [ ] **A `Ready` id is re-applied when its PRP file exists** (verified for
      BOTH the per-item-dir layout and the runtime `prps/` layout).
- [ ] **A `Researching` id is re-applied when its `research/` dir exists**.
- [ ] **An id with NEITHER PRP nor `research/` is left at the reverted
      (committed-blob) status** — NOT resurrected.
- [ ] **A stray file (not a directory) named `research` does NOT flip an item to
      `Researching`** (the probe checks `isDirectory()`).
- [ ] **The existing "PATH B — preserves Researching status across a git
      restore" test STILL passes** (its working-tree snapshot is `[]` → S2
      re-applies nothing → committed Researching preserved by the restore write).
- [ ] **100% coverage on `src/core/tasks-json-recovery.ts` is maintained**:
      `npm run test:coverage` GREEN for the file.
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the exact file
(`src/core/tasks-json-recovery.ts`), the exact integration point (PATH B's
`withLockedTasksJSON` mutator, the block that currently calls
`setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)`), the
exact helper signature (`resolveResearchStatus(itemId, sessionDir):
Promise<Status | null>`), the exact FS-path patterns to probe (with line-number
proofs from `prp-generator.ts`/`prp-runtime.ts`/`models.ts`), the exact
legitimate-delta-precedence rule, the exact ~7 tests to write, and confirms S1
is already landed (so the implementer consumes, not re-implements).

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/core/tasks-json-recovery.ts
  why: THE FILE YOU MODIFY. (1) S1 is ALREADY LANDED here: `snapshotResearchingReadyIds`
       (lines ~41-89), `RESEARCH_PRESERVE_STATUSES` (~38), the
       `preservedResearchingReadyIds: readonly string[]` field on
       `TasksJsonRecoveryResult` (~140-155), and the PATH-B capture-before-gitFileHistory
       wiring all EXIST. READ the whole file first — DO NOT re-add any of these. (2) S2's
       ONLY production change is: add `resolveResearchStatus` helper + a re-apply loop in
       PATH B's `withLockedTasksJSON` mutator (~lines 285-300, the block after the git walk
       that does `setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status)`).
       (3) Update the `recoverTasksJson` JSDoc (~160-205) and the PATH-B inline comment
       (~280 "Researching/Retrying items are preserved automatically (we mutate ONLY the
       target item)").
  pattern: PATH B mutator currently (paraphrased):
       const written = await withLockedTasksJSON(
         sessionDir,
         base => {
           const useFresh = validateBacklogState(base).isValid;
           const target = useFresh ? base : (structuredClone(restoredBacklog!) as Backlog);
           setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status);
           return target;   // ← S2 inserts the snapshot re-apply loop HERE, before `return target`
         },
         undefined,
         restoredBacklog
       );
   S2 inserts, before `return target`:
       for (const id of preservedResearchingReadyIds) {
         if (id === legitimateDelta.itemId) continue; // legitimate delta wins
         const status = await resolveResearchStatus(id, sessionDir);
         if (status) setItemStatus(target, id, status);
       }
  gotcha: `preservedResearchingReadyIds` is ALREADY in scope in PATH B (S1 captured it into a
          local before `gitFileHistory`). Verify by reading the PATH-B block — the variable name
          is whatever S1 used (likely `snapshotIds` or it's read from the snapshot call). If S1
          stored it in a local, reference that local directly; do NOT re-call
          snapshotResearchingReadyIds (the file may have changed between capture and re-apply).

- file: src/agents/prp-generator.ts   # lines 232-233, 654-655
  why: PROOF of the runtime PRP path pattern: `join(this.sessionPath, 'prps', `${sanitized}.md`)`
       where `sanitized = taskId.replace(/\./g, '_')`. So `P1.M1.T1.S2` → `prps/P1M1T1S2.md`.
       S2's `resolveResearchStatus` MUST probe this layout (in addition to the per-item-dir
       layout) so existing sessions with runtime-layout PRPs are correctly detected.
  pattern: `const sanitized = taskId.replace(/\./g, '_'); return join(sessionPath, 'prps', `${sanitized}.md`);`

- file: src/agents/prp-runtime.ts   # line 195
  why: SECOND PROOF of the runtime PRP path: `const sanitizedId = subtask.id.replace(/\./g, '_');
       const prpPath = join(this.#sessionPath, 'prps', `${sanitizedId}.md`);`. Confirms the
       pattern is used by BOTH generation and execution → it is THE canonical runtime layout.
       The PRP file extension is `.md` (the `.json` in prp-generator.ts:655 is the GENERATION
       cache, written as JSON content into a `.json` file — NOT a PRP the coder reads; do not
       probe `.json` for Ready evidence).

- file: src/core/models.ts   # lines 1478, 1527
  why: PROOF of the per-item-dir PRP path pattern: `prpPath: 'plan/001_14b9dc2a33c7/P1M2T2S2/PRP.md'`
       with `@format plan/{sequence}_{hash}/{taskId}/PRP.md`. This is the per-item-directory
       layout used by this session and documented as the canonical format. S2's
       `resolveResearchStatus` MUST ALSO probe `{sessionDir}/{sanitizedId}/PRP.md`. Probing BOTH
       layouts is explicitly authorized by the work item ("or the PRP path pattern used by the
       codebase").

- file: src/utils/task-utils.ts   # setItemStatus (line ~527)
  why: REFERENCE ONLY — do NOT modify. `setItemStatus(backlog, itemId, status)` mutates the item
       in place via DFS, returns `true` if found. S2 calls it inside the PATH-B mutator to
       re-apply each snapshotted id. It is idempotent (setting the existing status is a no-op)
       and safe to call multiple times. Reuse it — do NOT write a new DFS.
  pattern: `setItemStatus(target, id, status);`  // target is the Backlog being mutated in the RMW

- file: src/core/file-lock.ts   # withLockedTasksJSON (line 491)
  why: REFERENCE — confirms the locked RMW signature
       `withLockedTasksJSON(sessionDir, mutator, opts?, readFallback?)`. S2's re-apply runs
       INSIDE the existing `mutator` callback in PATH B (no new withLockedTasksJSON call). The
       mutator receives the `base` Backlog (fresh read or restored fallback) and must RETURN the
       mutated Backlog (which withLockedTasksJSON atomically writes). S2 adds work inside the
       callback before `return target`.
  gotcha: the `mutator` is `(backlog) => Backlog | Promise<Backlog>` — it CAN be async. S2's
          `await resolveResearchStatus(...)` inside it is fine (withLockedTasksJSON awaits the
          mutator result). The lock is held across the await; that's intended and safe (the FS
          probes are fast, pure reads).

- file: tests/unit/core/tasks-json-recovery.test.ts
  why: THE TEST FILE YOU MODIFY. REUSE: `makeValidBacklog({s1Status?, s2Status?})` (add
       `s3Status` for a 3rd item, or inline), `makeRepo()` → `{dir, git}`, `commitBacklog`,
       `findSubtask`, `tasksPath()`, imported `readTasksJSON`. The existing 'PATH B — preserves
       Researching status across a git restore' test (~line 230) STAYS (its snapshot is `[]` → S2
       no-op). ADD the ~7 tests in research/04-test-design.md.
  pattern: to force PATH B with an extractable snapshot, write a working-tree file that is
           JSON-parseable but BacklogSchema-INVALID (delete a required field from an UNRELATED
           subtask), keeping the {id,status} nodes of interest intact. See research/04 §"Forcing
           PATH B".
  gotcha: in tests, `sessionDir === dir` (because `tasksPath() = join(dir,'tasks.json')` →
          `dirname = dir`). So write PRP/research artifacts under `dir` directly:
          `mkdir(join(dir, 'P1M1T1S2'), {recursive:true})` + `writeFile(join(dir,'P1M1T1S2','PRP.md'),'# PRP')`
          OR `mkdir(join(dir,'prps'),{recursive:true})` + `writeFile(join(dir,'prps','P1M1T1S2.md'),'# PRP')`.

- file: plan/008_15504f60a0ef/P3M2T1S1/PRP.md
  why: THE SIBLING CONTRACT (S1). Read it to confirm the exact `preservedResearchingReadyIds`
       semantics: populated on PATH B, `[]` on PATH A/C, read from the working-tree file (not
       in-memory). S2 consumes this field. NOTE: S1's PRP is a SPEC — the actual code is what
       matters; both agree at HEAD (verified in research/01-s1-contract-state.md).

- docfile: plan/008_15504f60a0ef/P3M2T1S2/research/02-fs-evidence-path-patterns.md
  why: The full derivation of the two PRP layouts + the research/ directory convention, with
       line-number proofs. Read this before implementing `resolveResearchStatus`.

- docfile: plan/008_15504f60a0ef/P3M2T1S2/research/03-integration-design.md
  why: Why re-apply INSIDE the locked RMW (Option B) not in the caller (Option A), the
       legitimate-delta-precedence rule, and the exact mutator insertion point.
```

### Current Codebase tree (relevant slice)

```bash
src/
  core/
    tasks-json-recovery.ts   # MODIFY — add resolveResearchStatus helper; re-apply loop in PATH B mutator; update JSDoc + inline comment
    models.ts                # READ-ONLY — Status type (line 175); PRPArtifact prpPath @format (line 1478)
    file-lock.ts             # READ-ONLY — withLockedTasksJSON (S2 runs inside existing mutator)
    session-utils.ts         # READ-ONLY — readTasksJSON (diskClean probe; unchanged)
    state-validator.ts       # READ-ONLY — validateBacklogState (forces PATH B when invalid; unchanged)
  agents/
    prp-generator.ts         # READ-ONLY — runtime PRP path proof (line 232: prps/{sanitized}.md)
    prp-runtime.ts           # READ-ONLY — runtime PRP path proof (line 195)
  utils/
    task-utils.ts            # READ-ONLY — setItemStatus DFS (S2 calls it per snapshotted id)
  core/
    task-orchestrator.ts     # READ-ONLY — the CALLER; unchanged (picks up recovery.backlog)
tests/
  unit/
    core/
      tasks-json-recovery.test.ts   # MODIFY/ADD — ~7 new tests for FS-evidence-gated re-apply
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/tasks-json-recovery.ts
  # MODIFIED (additive; S1's snapshot machinery is untouched):
  #   + async function resolveResearchStatus(itemId: string, sessionDir: string): Promise<Status | null>
  #       (probes {sessionDir}/{sanitizedId}/PRP.md, {sessionDir}/prps/{sanitizedId}.md → 'Ready';
  #        {sessionDir}/{sanitizedId}/research (must be dir) → 'Researching'; else null; never throws)
  #   + PATH B withLockedTasksJSON mutator: after setItemStatus(legitimateDelta...),
  #       iterate preservedResearchingReadyIds (skip legitimateDelta.itemId), re-apply gated on FS evidence
  #   ~ recoverTasksJson JSDoc: document snapshot-before-revert + FS-evidence-gating (Mode A docs)
  #   ~ PATH B inline comment: "explicit snapshot re-apply gated on FS evidence" replaces "preserved automatically"
tests/unit/core/tasks-json-recovery.test.ts
  # MODIFIED:
  #   + makeValidBacklog gains s3Status? override (for a 3rd item) — OR inline a fixture
  #   + 'PATH B — re-applies snapshotted Ready id when PRP.md exists (per-item-dir layout)'
  #   + 'PATH B — re-applies snapshotted Ready id from runtime layout (prps/{sanitizedId}.md)'
  #   + 'PATH B — re-applies snapshotted Researching id when research/ dir exists'
  #   + 'PATH B — leaves item at reverted status when NEITHER PRP.md nor research/ exists'
  #   + 'PATH B — legitimate delta takes precedence over snapshot re-apply (id skipped)'
  #   + 'PATH B — stray file named "research" does not flip to Researching (isDirectory check)'
  #   + 'PATH A and PATH C do NOT re-apply (snapshot [] / no restored backlog)'
  #   (existing 'PATH B — preserves Researching status across a git restore' UNCHANGED — still passes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: S1 is ALREADY LANDED. Do NOT re-implement snapshotResearchingReadyIds, do NOT
// re-add the preservedResearchingReadyIds field, do NOT re-wire the capture-before-gitFileHistory.
// READ src/core/tasks-json-recovery.ts first. S2 CONSUMES the snapshot; it does not produce it.

// CRITICAL: re-apply runs INSIDE the existing withLockedTasksJSON mutator in PATH B (the same
// locked RMW that applies the legitimate delta). Do NOT add a second withLockedTasksJSON call
// in PATH B or in the caller — a second locked write opens a lost-update window (the supervisor
// could land a Ready between the restore write and the re-apply). The mutator callback may be
// async (withLockedTasksJSON awaits it), so `await resolveResearchStatus(...)` inside it is fine.

// CRITICAL: the legitimate delta takes precedence. If a snapshotted id === legitimateDelta.itemId,
// SKIP it — the orchestrator's intended status (Complete/Failed/Planned) for the item just
// implemented/interrupted must NOT be reverted to Ready/Researching by the snapshot. The existing
// setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status) runs FIRST; the re-apply
// loop runs AFTER but skips the legitimate-delta id.

// CRITICAL: probe BOTH PRP layouts. The codebase has two:
//   (A) per-item-dir: {sessionDir}/{sanitizedId}/PRP.md   (models.ts @format; this session's layout)
//   (B) runtime:      {sessionDir}/prps/{sanitizedId}.md  (prp-generator.ts:232, prp-runtime.ts:195)
// If EITHER exists → 'Ready'. This is explicitly authorized by the work item ("or the PRP path
// pattern used by the codebase"). Do NOT probe the .json generation cache (prp-generator.ts:655).

// CRITICAL: the research/ probe must check isDirectory(). A stray FILE named "research" must NOT
// flip an item to Researching. Use `(await stat(p)).isDirectory()` and catch errors → false.

// CRITICAL: resolveResearchStatus must NEVER throw. Every stat is in try/catch returning false.
// A permission error, a dangling symlink, a race where the dir is deleted mid-stat — all degrade
// to "evidence absent" → null → leave reverted status. PATH B's outer non-fatal guard would
// swallow a throw anyway, but an uncaught throw masks the real recovery reason with a PATH-C result.

// GOTCHA: the snapshot variable name in PATH B is whatever S1 used (read the code — likely
// `snapshotIds` or it's read directly from the snapshot call result). Reference THAT local; do NOT
// re-call snapshotResearchingReadyIds (the working-tree file may have changed between capture and
// re-apply — re-reading would give a different snapshot than the one S1 stashed in the result).

// GOTCHA: PATH A returns preservedResearchingReadyIds: [] and does NOT re-apply. Rationale: PATH A
// means disk was schema-valid → the supervisor's Ready/Researching writes are ALREADY on disk
// (intact). Re-applying would be a no-op at best and could clobber a just-landed write at worst.

// GOTCHA: PATH C (no-valid-version AND outer-catch) writes NOTHING. The snapshot may be populated
// on the no-valid-version site (for observability) but there is no restored backlog to re-apply
// onto — leave on-disk state as-is (PRD §5.1 "leaves state as-is"). S2 does NOT write in PATH C.

// GOTCHA: the existing 'PATH B — preserves Researching status across a git restore' test writes
// fully-corrupt working-tree bytes ('NOT JSON {{{'). The snapshot is [] (S1 lenient parse fails) →
// S2 re-applies NOTHING → the committed Researching is preserved by the restore write (committed
// blob carries it). This test STILL PASSES after S2. Do NOT change it.

// GOTCHA: 100% coverage is ENFORCED (vitest thresholds 100% on src/**/*.ts). resolveResearchStatus
// has branches: Ready-via-per-item-dir, Ready-via-runtime, Researching-via-dir, null, stat-error.
// ALL must be exercised. The isDirectory() check needs a test with a stray file named "research".

// GOTCHA: when forcing PATH B in tests, the working-tree file must be JSON-parseable but
// BacklogSchema-INVALID (so S1's lenient snapshot extracts the ids). Delete a required field from
// an UNRELATED subtask (e.g. `delete (s1 as any).story_points`). Verify
// validateBacklogState(invalid).isValid === false BEFORE writing the fixture. Do NOT corrupt the
// JSON syntax for the "Ready re-applied" tests — that makes the snapshot [] (separate test case).
```

---

## Implementation Blueprint

### Data models and structure

No new exported types. One new module-private helper returning `Status | null`.

```typescript
// src/core/tasks-json-recovery.ts — NEW addition:

/**
 * Resolve the research status to re-apply for a snapshotted item id, gated on
 * FILESYSTEM EVIDENCE (PRD §5.1, P3.M2.T1.S2).
 *
 * @param itemId - The hierarchy id (e.g. `P1.M1.T1.S2`).
 * @param sessionDir - Absolute session directory (parent of tasks.json).
 * @returns `'Ready'` if the item's PRP file exists (either layout), `'Researching'`
 *   if its `research/` directory exists, `null` if neither (leave the reverted
 *   status). NEVER throws.
 *
 * @remarks
 * The codebase has two PRP layouts:
 *  - per-item-dir: `{sessionDir}/{sanitizedId}/PRP.md`  (models.ts @format)
 *  - runtime:      `{sessionDir}/prps/{sanitizedId}.md` (prp-generator.ts:232,
 *    prp-runtime.ts:195)
 * Either counts as Ready evidence. The `research/` directory probe uses the
 * per-item-dir layout (`{sessionDir}/{sanitizedId}/research`) and requires it be
 * a DIRECTORY (a stray file named `research` does not count). All probes are
 * best-effort: any `stat` error degrades to "evidence absent."
 */
async function resolveResearchStatus(
  itemId: string,
  sessionDir: string
): Promise<Status | null> {
  const sanitizedId = itemId.replace(/\./g, '_');
  const prpCandidates = [
    join(sessionDir, sanitizedId, 'PRP.md'), // per-item-dir layout (models.ts)
    join(sessionDir, 'prps', `${sanitizedId}.md`), // runtime layout (prp-generator/runtime)
  ];
  const researchCandidate = join(sessionDir, sanitizedId, 'research');

  const pathExists = async (p: string): Promise<boolean> => {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  };
  const dirExists = async (p: string): Promise<boolean> => {
    try {
      return (await stat(p)).isDirectory();
    } catch {
      return false;
    }
  };

  for (const candidate of prpCandidates) {
    if (await pathExists(candidate)) return 'Ready';
  }
  if (await dirExists(researchCandidate)) return 'Researching';
  return null;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the resolveResearchStatus helper to src/core/tasks-json-recovery.ts
  - ADD to imports: `stat` from `node:fs/promises` (the file already imports `readFile` from
    node:fs/promises per S1 — ADD `stat` to that named-import list). Add `join` to the existing
    `node:path` import if not present (S1 imported `dirname, relative, resolve`; ADD `join`).
  - ADD the `resolveResearchStatus` function (above) in the private-helpers section, right next
    to S1's `snapshotResearchingReadyIds`. It is module-private (NOT exported).
  - NAMING: camelCase function; `prpCandidates` / `researchCandidate` / `pathExists` / `dirExists`
    are local consts. `Status` is already imported from `./models.js`.
  - GOTCHA: do NOT import ItemTypeEnum/zod. Do NOT use readTasksJSON. Use raw `stat`.
  - VERIFY: npx tsc --noEmit passes (no implicit any; Status is the imported type).

Task 2: ADD the snapshot re-apply loop to PATH B's withLockedTasksJSON mutator
  - LOCATE PATH B's mutator (the block after the git-walk that does
    `setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status); return target;`).
  - IMMEDIATELY BEFORE `return target;`, ADD:
      // PRD §5.1 / P3.M2.T1.S2: re-apply snapshotted Researching/Ready ids gated on
      // filesystem evidence (PRP.md → Ready; research/ dir → Researching). The
      // legitimate-delta item is skipped (its status is authoritative for this run).
      for (const id of preservedResearchingReadyIds) {
        if (id === legitimateDelta.itemId) continue;
        const status = await resolveResearchStatus(id, sessionDir);
        if (status) setItemStatus(target, id, status);
      }
  - NOTE: `preservedResearchingReadyIds` is the local S1 captured before `gitFileHistory`.
    READ the code to confirm its exact name (likely `snapshotIds` or whatever S1 named the
    capture). If S1 stored it in a local, reference that local. Do NOT re-call
    snapshotResearchingReadyIds.
  - NOTE: `sessionDir` is already computed at the top of recoverTasksJson
    (`const sessionDir = dirname(resolve(tasksPath))`). It is in scope inside the mutator
    (closure). Use it directly.
  - NOTE: the mutator is `(base) => Backlog | Promise<Backlog>`; making it `async` (it may
    already be `async base =>` — check) is fine because withLockedTasksJSON awaits the result.
    If the mutator is NOT currently async, change `base => {` to `async base => {` (the
    `await resolveResearchStatus(...)` requires it). Verify withLockedTasksJSON's mutator type
    accepts Promise<Backlog> (it does — file-lock.ts:491 `mutator: (backlog) => Backlog | Promise<Backlog>`).
  - PRESERVE: all other PATH-B logic — the git walk, the useFresh/restoredBacklog selection,
    the readFallback, the legitimate-delta setItemStatus. The re-apply is purely ADDITIVE
    (a loop before `return target`).
  - GOTCHA: do NOT re-apply in PATH A or PATH C. PATH A's snapshot is [] (and disk is already
    valid → supervisor writes intact). PATH C has no restored backlog.
  - VERIFY: npx tsc --noEmit passes.

Task 3: UPDATE the recoverTasksJson JSDoc + the PATH-B inline comment (Mode A docs)
  - recoverTasksJson JSDoc (the "Corrupt disk" bullet, ~line 180): currently says
    "Preserves items currently in `Researching` or `Ready` status: the pre-revert snapshot
    (P3.M2.T1.S1) captures their IDs from the working-tree file, and P3.M2.T1.S2 re-applies
    them afterward gated on filesystem evidence." — S1 already wrote this text; CONFIRM it is
    present and accurate. If S1 left a placeholder or the older "Researching/Retrying … There
    is NO Ready status" text, replace it with the S2-accurate version above.
  - PATH-B inline comment (~line 280, "Researching/Retrying items are preserved automatically
    (we mutate ONLY the target item)"): REPLACE with:
      "The legitimate delta is applied first (authoritative for this run). Then snapshotted
       Researching/Ready ids (P3.M2.T1.S1) are re-applied gated on filesystem evidence
       (P3.M2.T1.S2): PRP.md → Ready, research/ dir → Researching, else left at the reverted
       status. The legitimate-delta id is skipped. Items in the COMMITTED blob's Researching/
       Ready that are NOT in the snapshot are NOT re-gated (the snapshot is the authoritative
       set of supervisor-written statuses)."
  - ADD a JSDoc note to `resolveResearchStatus` citing PRD §5.1 + P3.M2.T1.S2 (already in the
    helper's JSDoc above).
  - PRESERVE: do NOT rewrite unrelated JSDoc. Touch ONLY the corrupt-disk bullet, the PATH-B
    inline comment, and the new helper's JSDoc.

Task 4: MODIFY tests/unit/core/tasks-json-recovery.test.ts
  - READ the existing suite + makeValidBacklog fixture first.
  - EXTEND makeValidBacklog to accept `s3Status?: Status` and add a third subtask `P1.M1.T1.S3`
    (dependencies: ['P1.M1.T1.S2'], story_points: 1) — OR inline a 3-item fixture in the tests
    that need it. Prefer extending the fixture (less duplication).
  - ADD a sanitized-id helper at the top: `const san = (id: string) => id.replace(/\./g, '_');`
  - ADD test: 'PATH B — re-applies snapshotted Ready id when PRP.md exists (per-item-dir layout)':
      * SETUP: commit baseline makeValidBacklog({ s2Status: 'Planned' }).
      * Write working-tree file: makeValidBacklog({ s2Status: 'Ready' }) with an UNRELATED
        schema violation (delete (s1 as any).story_points) → JSON.stringify → write. This forces
        PATH B (validateBacklogState invalid) while S1's snapshot extracts ['P1.M1.T1.S2'].
      * Write the Ready evidence: mkdir(join(dir, san('P1.M1.T1.S2'))) + writeFile(join(dir,
        san('P1.M1.T1.S2'), 'PRP.md'), '# PRP').
      * EXECUTE: recoverTasksJson(tasksPath(), { itemId:'P1.M1.T1.S1', status:'Complete' }, { repoPath: dir }).
      * VERIFY: const after = await readTasksJSON(dir);
        expect(findSubtask(after, 'P1.M1.T1.S2')!.status).toBe('Ready');  // re-applied
        expect(result.preservedResearchingReadyIds).toContain('P1.M1.T1.S2');
  - ADD test: 'PATH B — re-applies snapshotted Ready id from runtime layout (prps/{sanitizedId}.md)':
      * Same as above but write join(dir, 'prps', `${san('P1.M1.T1.S2')}.md`) instead.
      * VERIFY: findSubtask(after, 'P1.M1.T1.S2')!.status === 'Ready'.
  - ADD test: 'PATH B — re-applies snapshotted Researching id when research/ dir exists':
      * SETUP: commit baseline makeValidBacklog({ s3Status: 'Planned' }). Working tree:
        makeValidBacklog({ s3Status: 'Researching' }) + unrelated schema violation.
      * Write mkdir(join(dir, san('P1.M1.T1.S3'), 'research'), { recursive: true }).
      * EXECUTE + VERIFY: findSubtask(after, 'P1.M1.T1.S3')!.status === 'Researching'.
  - ADD test: 'PATH B — leaves item at reverted status when NEITHER PRP.md nor research/ exists':
      * SETUP: commit baseline s2Status 'Planned'. Working tree: s2Status 'Ready' + schema
        violation. Do NOT write any PRP.md or research/.
      * EXECUTE + VERIFY: findSubtask(after, 'P1.M1.T1.S2')!.status === 'Planned' (reverted
        baseline wins; no FS evidence). result.preservedResearchingReadyIds still contains the id.
  - ADD test: 'PATH B — legitimate delta takes precedence over snapshot re-apply':
      * SETUP: commit baseline s1Status 'Planned'. Working tree: s1Status 'Researching' (SAME id
        as the legitimate delta) + schema violation elsewhere. Write research/ dir for S1.
      * EXECUTE: recover with delta { itemId:'P1.M1.T1.S1', status:'Complete' }.
      * VERIFY: findSubtask(after, 'P1.M1.T1.S1')!.status === 'Complete' (NOT Researching —
        legitimate delta wins because id === legitimateDelta.itemId is skipped).
  - ADD test: 'PATH B — stray file named "research" does not flip to Researching':
      * SETUP: commit baseline s2Status 'Planned'. Working tree: s2Status 'Researching' + schema
        violation. Write a FILE (not dir) at join(dir, san('P1.M1.T1.S2'), 'research').
      * EXECUTE + VERIFY: findSubtask(after, 'P1.M1.T1.S2')!.status === 'Planned' (isDirectory
        check rejects the stray file → null → reverted status).
  - ADD test: 'PATH A and PATH C do NOT re-apply':
      * PATH A variant: commit clean baseline s2Status 'Ready'. Leave working tree clean (no
        corruption). recover with delta {S1→Complete}. Assert result.source === 'disk',
        result.restored === false, and findSubtask(after,'P1.M1.T1.S2').status === 'Ready'
        (untouched — PATH A didn't revert it). [This is essentially the existing PATH A behavior
        with a Ready item; confirms PATH A is a no-op for the snapshot.]
      * PATH C variant: commit NOTHING (empty repo). Write working-tree file with a Ready id +
        schema violation (force PATH B) AND write the PRP.md. recover. Assert result.restored ===
        false, result.reason matches /no valid version/, result.preservedResearchingReadyIds
        contains the id (S1 captured it), BUT on-disk file is UNTOUCHED (still the invalid bytes
        — read raw with readFile, do NOT use readTasksJSON which throws). S2 wrote nothing.
  - PRESERVE: all existing tests unchanged. The 'PATH B — preserves Researching status across a
    git restore' test STILL passes (its snapshot is [] → S2 no-op).
  - GOTCHA: verify each PATH-B-forcing fixture with a quick mental check: does
    validateBacklogState(invalid).isValid === false? If not, PATH A runs and the test fails
    confusingly. Deleting a required subtask field (story_points/context_scope/dependencies) is
    the safest violation.

Task 5: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/core/tasks-json-recovery.ts
  - RUN: npx prettier --check src/core/tasks-json-recovery.ts tests/unit/core/tasks-json-recovery.test.ts
  - RUN: npx vitest run tests/unit/core/tasks-json-recovery.test.ts -v
  - RUN: npx vitest run --coverage src/core/tasks-json-recovery.ts   # CONFIRM 100%
  - RUN: npm run validate
  - EXPECT: GREEN. If red:
    * "Cannot find name 'stat'" / "'join' is not defined" → forgot to add stat/join to the imports.
    * coverage < 100% → a resolveResearchStatus branch (Ready-via-runtime, Researching-via-dir,
      null, stat-error, isDirectory-false) is untested. Add the missing test.
    * "Promise<...> is not assignable to Backlog" → the mutator must be `async base =>` (S2's
      await requires it); check withLockedTasksJSON's mutator type accepts Promise<Backlog>
      (it does).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: resolveResearchStatus — best-effort FS evidence, never throws.
async function resolveResearchStatus(
  itemId: string,
  sessionDir: string
): Promise<Status | null> {
  const sanitizedId = itemId.replace(/\./g, '_');
  const prpCandidates = [
    join(sessionDir, sanitizedId, 'PRP.md'), // per-item-dir layout (models.ts)
    join(sessionDir, 'prps', `${sanitizedId}.md`), // runtime layout (prp-generator/runtime)
  ];
  const researchCandidate = join(sessionDir, sanitizedId, 'research');

  const pathExists = async (p: string): Promise<boolean> => {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  };
  const dirExists = async (p: string): Promise<boolean> => {
    try {
      return (await stat(p)).isDirectory();
    } catch {
      return false;
    }
  };

  for (const candidate of prpCandidates) {
    if (await pathExists(candidate)) return 'Ready';
  }
  if (await dirExists(researchCandidate)) return 'Researching';
  return null;
}

// PATTERN: PATH B mutator re-apply (insert before `return target`).
const written = await withLockedTasksJSON(
  sessionDir,
  async base => {
    const useFresh = validateBacklogState(base).isValid;
    const target = useFresh
      ? base
      : (structuredClone(restoredBacklog!) as Backlog);
    setItemStatus(target, legitimateDelta.itemId, legitimateDelta.status); // legitimate delta FIRST
    // S2: re-apply snapshotted Researching/Ready ids gated on FS evidence.
    for (const id of preservedResearchingReadyIds) {
      if (id === legitimateDelta.itemId) continue; // legitimate delta wins
      const status = await resolveResearchStatus(id, sessionDir);
      if (status) setItemStatus(target, id, status);
    }
    return target;
  },
  undefined,
  restoredBacklog
);

// CRITICAL INVARIANTS:
// 1. resolveResearchStatus NEVER throws (all stat in try/catch → false).
// 2. BOTH PRP layouts are probed (per-item-dir + runtime); either → Ready.
// 3. research/ probe requires isDirectory() (stray file rejected).
// 4. Re-apply runs INSIDE the same locked RMW as the legitimate delta (no second lock, no
//    lost-update window). The mutator is async; withLockedTasksJSON awaits it.
// 5. The legitimate-delta id is SKIPPED (its status is authoritative for this run).
// 6. PATH A (snapshot []) and PATH C (no restored backlog) do NOT re-apply.
// 7. S1's snapshot machinery is UNCHANGED — S2 only consumes preservedResearchingReadyIds.
```

### Integration Points

```yaml
RECOVERY UTILITY:
  - modify: src/core/tasks-json-recovery.ts
  - new helper: resolveResearchStatus(itemId, sessionDir) — module-private, best-effort, never throws
  - new logic: PATH B withLockedTasksJSON mutator — snapshot re-apply loop after legitimate delta
  - docs: recoverTasksJson JSDoc (corrupt-disk bullet) + PATH-B inline comment (Mode A, rides with work)
  - untouched: snapshotResearchingReadyIds, RESEARCH_PRESERVE_STATUSES,
    TasksJsonRecoveryResult.preservedResearchingReadyIds (all S1), PATH A, PATH C, git-walk,
    withLockedTasksJSON, models.ts, file-lock.ts, task-utils.ts, state-validator.ts,
    session-utils.ts, git-mcp.ts

CALLER:
  - src/core/task-orchestrator.ts:#recoverAfterAgentRun is UNCHANGED. It already does
    `const recovered = recovery.backlog ?? ...` and sets the taskRegistry. Because S2 mutates
    `target` INSIDE recovery's locked RMW, `recovery.backlog` already carries the re-applied
    statuses — the caller picks them up with zero changes.

NO CONFIG CHANGES:
  - work item DOCS contract is Mode A (JSDoc rides with the work) — no .env.example,
    no constants.ts, no docs/CONFIGURATION.md edit.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing tasks-json-recovery.ts - fix before proceeding
npx tsc --noEmit -p tsconfig.json            # typecheck (catches missing imports stat/join, async mutator)
npx eslint src/core/tasks-json-recovery.ts
npx prettier --check src/core/tasks-json-recovery.ts tests/unit/core/tasks-json-recovery.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# Common: "Cannot find name 'stat'" → add `stat` to the node:fs/promises import.
# Common: "'join' is not defined" → add `join` to the node:path import.
# Common: format:check fails → npx prettier --write on the modified files.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Modified recovery (PATH B FS-evidence re-apply paths)
npx vitest run tests/unit/core/tasks-json-recovery.test.ts -v

# Full core suite (no regressions in PATH A / PATH C / existing PATH B tests)
npx vitest run tests/unit/core/ -v

# CRITICAL: confirm 100% coverage on tasks-json-recovery.ts (project enforces 100%)
npx vitest run --coverage src/core/tasks-json-recovery.ts

# Expected: All tests pass AND coverage on src/core/tasks-json-recovery.ts is 100%.
# If coverage < 100%: a resolveResearchStatus branch (Ready-via-per-item-dir,
#   Ready-via-runtime, Researching-via-dir, null, stat-error, isDirectory-false) is untested.
#   Add the missing test. The isDirectory branch needs the stray-file-named-"research" test.
# Common test bug: the schema-violation trick didn't actually fail validateBacklogState → PATH A
#   ran → no re-apply. Verify validateBacklogState(invalid).isValid === false BEFORE the fixture.
# Common test bug: wrote artifacts under the WRONG sessionDir. In tests sessionDir === dir (the
#   tmpdir), NOT a nested plan/ dir. Write PRP/research under dir directly.
```

### Level 3: Integration Testing (System Validation)

```bash
# The existing tests/integration/core/tasks-json-recovery-e2e.test.ts uses REAL tmpdir + REAL
# git. Run it to confirm no regression:
npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts -v

# (No service to start — this is a recovery-utility change. The e2e exercises the real git walk
#  + restore path with real corruption, confirming the FS-evidence re-apply works in a realistic
#  setting if the e2e writes PRP/research artifacts. If the e2e does NOT write artifacts, the
#  snapshot re-apply is a no-op there — still safe.)
# Expected: e2e GREEN. Additive behavior + the result interface is unchanged (S1 already added
#   preservedResearchingReadyIds) → no structural assertion breaks.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This task has no web/Docker/DB/performance surface — it's FS-evidence-gated status re-apply
#  inside an existing locked recovery routine. The domain-specific validation is the unit tests
#  asserting: Ready re-applied for BOTH layouts; Researching re-applied for dir only; null when
#  neither; legitimate-delta precedence; PATH A/C no-op; stray-file rejection.)

# Optional: manual reasoning check — construct the orphaning scenario: supervisor wrote Ready to
# disk (uncommitted), an agent truncated the file, recovery runs, and the PRP.md exists. Confirm
# via the 'PATH B — re-applies snapshotted Ready id' test that the item ends up Ready (not
# Planned). This is the core PRD §5.1 guarantee that S2 closes.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run validate` GREEN (lint + format:check + typecheck + test:run)
- [ ] No linting errors: `npx eslint src/core/tasks-json-recovery.ts`
- [ ] No type errors: `npx tsc --noEmit -p tsconfig.json`
- [ ] No formatting issues: `npx prettier --check` on modified files
- [ ] **100% coverage on `src/core/tasks-json-recovery.ts`**:
      `npx vitest run --coverage src/core/tasks-json-recovery.ts`

### Feature Validation

- [ ] `resolveResearchStatus(itemId, sessionDir)` helper exists, best-effort, never throws
- [ ] PATH B mutator re-applies `preservedResearchingReadyIds` after the legitimate delta
- [ ] Both PRP layouts probed (per-item-dir `PRP.md` + runtime `prps/{sanitizedId}.md`)
- [ ] `research/` probe requires `isDirectory()` (stray file rejected)
- [ ] Legitimate-delta id is skipped (`id === legitimateDelta.itemId` → continue)
- [ ] Item left at reverted status when NEITHER PRP nor research/ exists
- [ ] PATH A unchanged (snapshot `[]`, no re-apply)
- [ ] PATH C unchanged (no restored backlog → no write; snapshot returned for observability)
- [ ] S1's snapshot machinery (`snapshotResearchingReadyIds`, field, capture wiring) UNCHANGED
- [ ] The existing "PATH B — preserves Researching status across a git restore" test passes
- [ ] The `recoverTasksJson` JSDoc + PATH-B inline comment updated (Mode A docs)

### Code Quality Validation

- [ ] `resolveResearchStatus` is module-private (not exported)
- [ ] Re-apply runs INSIDE the existing `withLockedTasksJSON` mutator (no second lock)
- [ ] No new dependencies (`package.json` `dependencies` byte-identical)
- [ ] JSDoc on the helper + the corrupt-disk bullet cites PRD §5.1, P3.M2.T1.S1, P3.M2.T1.S2
- [ ] No new config surface (work item DOCS is Mode A — JSDoc only)
- [ ] The PRD §5.1 guarantee ("re-applied afterward gated on filesystem evidence") is satisfied
      and documented in the code

### Documentation & Deployment

- [ ] Code is self-documenting with clear variable/function names
- [ ] The corrected comment explains WHY the legitimate delta takes precedence
- [ ] The corrected comment explains WHY PATH A/C do not re-apply

---

## Anti-Patterns to Avoid

- ❌ Don't re-implement the snapshot — S1 is landed. CONSUME
  `preservedResearchingReadyIds`; do NOT re-call `snapshotResearchingReadyIds` (the file may
  have changed between capture and re-apply).
- ❌ Don't add a SECOND `withLockedTasksJSON` call for the re-apply (in PATH B or the caller) —
  it opens a lost-update window. Re-apply INSIDE the existing mutator.
- ❌ Don't re-apply in PATH A or PATH C. PATH A's snapshot is `[]` and disk is already valid;
  PATH C has no restored backlog.
- ❌ Don't let `resolveResearchStatus` throw — wrap every `stat` in try/catch returning false.
  A throw masks the real recovery reason with a PATH-C result.
- ❌ Don't probe only ONE PRP layout — the codebase has two (per-item-dir `PRP.md` + runtime
  `prps/{sanitizedId}.md`). Probe BOTH; either → Ready. Do NOT probe the `.json` generation cache.
- ❌ Don't skip the `isDirectory()` check on `research/` — a stray file named `research` must not
  flip an item to Researching.
- ❌ Don't re-apply the legitimate-delta id — skip `id === legitimateDelta.itemId`. The
  orchestrator's intended status (Complete/Failed/Planned) is authoritative for that item.
- ❌ Don't re-gate EVERY committed Researching/Ready item — S2 iterates ONLY the SNAPSHOT
  (working-tree) ids. Committed-blob statuses are carried by the restore write and untouched by
  S2. (This is why the existing "preserves Researching across git restore" test still passes.)
- ❌ Don't make the mutator non-async if it needs `await` — change `base =>` to `async base =>`.
  `withLockedTasksJSON`'s mutator type accepts `Promise<Backlog>`.
- ❌ Don't modify `models.ts`, `file-lock.ts`, `task-utils.ts`, `state-validator.ts`,
  `session-utils.ts`, `git-mcp.ts`, or `task-orchestrator.ts`. This task touches ONLY
  `tasks-json-recovery.ts` + its test.
- ❌ Don't add config/env surface — the work item DOCS contract is Mode A (JSDoc rides with the
  work), and the S1 work item already said "DOCS: none — no user-facing/config/API surface
  change."
- ❌ Don't skip the coverage check — the project ENFORCES 100% on `src/**/*.ts`. Every
  `resolveResearchStatus` branch (both Ready layouts, Researching-dir, null, stat-error,
  isDirectory-false) AND the re-apply loop (hit + skip-legitimate-delta) must be exercised.