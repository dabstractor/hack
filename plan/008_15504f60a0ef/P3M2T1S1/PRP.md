# PRP — P3.M2.T1.S1: Snapshot live Researching/Ready IDs before git revert

---

## Goal

**Feature Goal**: Add a **pre-revert working-tree snapshot** to
`recoverTasksJson` (PATH B, the corrupt-disk → git-history restore branch in
`src/core/tasks-json-recovery.ts`) that captures the IDs of items currently in
`Researching` or `Ready` status **from the working-tree `tasks.json` file
before the git revert overwrites disk**. This is the first half of PRD §5.1's
*"Preserve background-research status (snapshot before revert)"* contract (the
second half — re-applying those statuses gated on filesystem evidence — is
sibling **P3.M2.T1.S2**, which consumes this snapshot).

The snapshot is read **directly from the working-tree file** (NOT an in-memory
index — PRD §5.1 explicitly forbids depending on an in-memory index "that can
drift out of sync with the supervisor"), and is extracted **best-effort**
because the working-tree file is corrupt by construction in PATH B (that is
*why* PATH B runs). It degrades gracefully to an empty list when the file is
unparseable or schema-invalid beyond recovery.

**Deliverable** (2 files: 1 modified production utility + 1 modified test):
1. **`src/core/tasks-json-recovery.ts`** — MODIFY:
   - Extend `TasksJsonRecoveryResult` with a new field
     `preservedResearchingReadyIds: readonly string[]`.
   - Add a private best-effort snapshot helper that reads the working-tree
     `tasks.json`, leniently extracts `Researching`/`Ready` item IDs, and
     returns them (empty array on any failure).
   - In PATH B, **before `gitFileHistory(...)`** (the git walk that leads to
     overwriting disk), capture the snapshot.
   - Thread the snapshot into **both** PATH-B return sites (the git-restore
     success site AND the no-valid-version failure site, so the snapshot is
     always available to consumers even when recovery itself fails).
   - Update the THREE stale code comments that claim "There is NO `Ready`
     status" — `models.ts:175` proves `Ready` IS a valid `Status`, and PRD §5.1
     line 187 names both `Researching` and `Ready`.
   - **No other path is touched.** PATH A (clean disk) is unchanged (there is
     no revert in PATH A, so no snapshot is needed — it returns
     `preservedResearchingReadyIds: []`).
2. **`tests/unit/core/tasks-json-recovery.test.ts`** — MODIFY/ADD: add tests
   covering (a) the snapshot is captured from the working tree in PATH B, (b)
   the snapshot is empty when the working-tree file is unparseable, (c) the
   snapshot is empty in PATH A (no revert), (d) the snapshot includes both
   `Researching` and `Ready` ids, (e) the snapshot survives even when the
   committed git version does NOT carry those statuses (the supervisor's
   uncommitted write).

**Scope note (critical):** This task is **ONLY the snapshot + its tests**. It
does NOT re-apply the statuses (that is S2's job), does NOT add filesystem
evidence gating (S2), does NOT add config/env/docs surface ("DOCS: none — no
user-facing/config/API surface change"), and does NOT modify `models.ts`,
`file-lock.ts`, `task-utils.ts`, `state-validator.ts`, `session-utils.ts`, or
`git-mcp.ts`. It **PRODUCES** a contract (the `preservedResearchingReadyIds`
field) that S2 will consume.

**Success Definition**:
- `recoverTasksJson` PATH B captures the working-tree `Researching`/`Ready` IDs
  before the git walk and returns them in `result.preservedResearchingReadyIds`.
- The snapshot is read from the **file** (working tree), verifiable by a test
  where the working-tree file has `Ready`/`Researching` items that are NOT in
  the committed git version — the snapshot still contains them.
- The snapshot is empty (`[]`) when the working-tree file is truncated garbage
  (graceful degradation — no throw).
- PATH A returns `preservedResearchingReadyIds: []` (no revert, no snapshot
  needed).
- The snapshot is captured **before** `gitFileHistory` runs (verifiable by test
  ordering or by reading the code: the snapshot read precedes the git walk).
- `npm run validate` GREEN; **100% coverage** on `src/core/tasks-json-recovery.ts`
  maintained.

---

## User Persona (if applicable)

**Target User**: The autonomous pipeline's background research supervisor
(P3.M1.T1 — the depth-chained ResearchQueue) and the orchestrator's
`recoverTasksJson` routine. No human in the loop.
**Use Case**: The background supervisor flips a subtask to `Ready` (PRP
written) or `Researching` (research in flight) in the working-tree
`tasks.json`. Meanwhile a Coder agent corrupts the file (truncated write) or
the orchestrator triggers recovery. Without the snapshot, the git-history
restore picks up the last *committed* version (which does NOT have the
supervisor's uncommitted `Ready`/`Researching` write) and the research status
is silently lost — the supervisor's work is orphaned and the item is
incorrectly reset to `Planned`. With the snapshot, S2 can re-apply the status
gated on filesystem evidence (PRP.md / research/ existence).
**User Journey**: orchestrator runs agent → agent corrupts `tasks.json` →
`recoverTasksJson` enters PATH B → **[NEW] read working-tree file, snapshot
Researching/Ready IDs** → `gitFileHistory` walk → restore last valid committed
version → re-apply legitimate delta → return `{restored:true,
preservedResearchingReadyIds: [...]}` → (S2) re-apply snapshot statuses gated
on FS evidence.
**Pain Points Addressed**: PRD §5.1 line 187 — *"Items marked `Researching` or
`Ready` by the background research queue must survive a restore. To do this
reliably, the restore logic snapshots the live `Researching`/`Ready` item IDs
from the working-tree `tasks.json` before the git revert … This must not depend
on an in-memory index that can drift out of sync with the supervisor."*

---

## Why

- **PRD compliance**: PRD §5.1 (h3.9) *"Preserve background-research status
  (snapshot before revert)"* mandates the snapshot come from the
  **working-tree file** before the git revert, and explicitly forbids depending
  on an in-memory index (because the orchestrator's `baselineBacklog` is the
  pre-agent snapshot and predates the supervisor's latest write — it can drift).
  The current code only "preserves Researching" *incidentally* via the committed
  git blob, which does NOT carry the supervisor's uncommitted writes. S1 ships
  the snapshot; S2 ships the re-apply.
- **Contract item 3 (LOGIC)**: *"In recoverTasksJson, before the git
  revert/recovery operation (PATH B), read the working-tree tasks.json and
  snapshot the IDs of items in 'Researching' and 'Ready' status. Store these
  IDs in a local variable or temporary structure. The snapshot must come from
  the working-tree file, not an in-memory index that can drift."*
  → implemented as a private `snapshotResearchingReadyIds` helper that reads
  the file directly and returns `readonly string[]`.
- **Contract item 4 (OUTPUT)**: *"Pre-revert snapshot of Researching/Ready IDs
  in recoverTasksJson. Consumed by P3.M2.T1.S2."* → the snapshot is returned in
  `result.preservedResearchingReadyIds`.
- **Contract item 1 (RESEARCH NOTE) — fix the stale comments**: The
  architecture note flags that the recovery code comment *"There is NO Ready
  status"* is contradicted by `models.ts:175` (the `Status` type DOES include
  `'Ready'`) and `architecture/system_context.md` Finding #2. S1 corrects
  these stale comments as part of implementing the snapshot (they would
  otherwise mislead the implementing agent and future readers).
- **Why best-effort / graceful degradation**: The working-tree file is corrupt
  *by construction* in PATH B (a clean schema-valid file would have taken PATH
  A). So the snapshot read will often fail to fully validate. The PRD's intent
  — *"must survive a restore"* — is satisfied by a best-effort extraction:
  parse what JSON we can, leniently walk for `{id, status}` nodes, and accept
  that on total corruption the snapshot is empty (S2 then re-applies nothing,
  which is exactly today's behavior). The snapshot must NEVER throw (PATH B's
  outer non-fatal guard already wraps everything, but the snapshot helper
  itself must be self-contained best-effort so it doesn't mask or interfere
  with the real recovery).

---

## What

One modified production utility (`tasks-json-recovery.ts`), one modified test
(`tasks-json-recovery.test.ts`). **No** config, **no** docs, **no** new files,
**no** new dependencies.

### Success Criteria

- [ ] **`TasksJsonRecoveryResult` gains a `preservedResearchingReadyIds:
      readonly string[]` field** (JSDoc cites PRD §5.1 + P3.M2.T1.S1 + the
      S2 consumer). It is always a defined array (never `undefined`).
- [ ] **A private helper `snapshotResearchingReadyIds(tasksPath: string):
      Promise<readonly string[]>` exists** in `tasks-json-recovery.ts`. It reads
      the working-tree file (best-effort `JSON.parse`), leniently walks the
      parsed object collecting any node's `id` whose string `status` is exactly
      `'Researching'` or `'Ready'` (validated via a small `Set` or
      `StatusEnum.safeParse`), and returns the ids. On any read/parse error it
      returns `[]`. It NEVER throws.
- [ ] **PATH B captures the snapshot BEFORE `gitFileHistory`**: the snapshot
      read is the first statement inside the PATH B block (after the `diskClean
      === false` fallthrough), preceding `const history = await
      gitFileHistory(relPath, repoPath)`.
- [ ] **The git-restore success return site includes
      `preservedResearchingReadyIds: snapshot`** (the `restored:true,
      source:'git'` return).
- [ ] **The no-valid-version failure return site ALSO includes
      `preservedResearchingReadyIds: snapshot`** (`restored:false, source:'disk',
      reason:'recovery failed: no valid version in git history'`). Rationale:
      even if git history has no valid version, the working-tree snapshot is
      still authoritative for what the supervisor wrote — S2 / a future caller
      may want it. (The PATH C outer-catch return may set it to `[]` because the
      snapshot variable may be out of scope there — see Implementation
      Blueprint.)
- [ ] **PATH A returns `preservedResearchingReadyIds: []`** (no revert → no
      snapshot). Verified by the existing PATH A test asserting the field is
      `[]`.
- [ ] **The snapshot is read from the FILE, not in-memory**: a test commits a
      backlog with S2 = `Planned`, then writes a working-tree file with S2 =
      `Ready` (uncommitted), corrupts nothing else that matters for the
      snapshot read, and asserts `result.preservedResearchingReadyIds` contains
      `'P1.M1.T1.S2'` even though the committed version has it as `Planned`.
- [ ] **The snapshot is empty on unparseable working-tree file**: a test writes
      truncated garbage to the working tree, runs recovery, and asserts
      `preservedResearchingReadyIds` is `[]` (no throw, graceful degradation).
- [ ] **The snapshot includes BOTH `Researching` and `Ready` ids**: a test with
      a working-tree file having one of each asserts both ids appear.
- [ ] **The THREE stale "There is NO Ready status" / module-docstring comments
      are corrected** to reflect that `Ready` IS a valid status (and the
      snapshot covers both `Researching` and `Ready`). Lines ~108, ~210, and the
      module docstring ~14.
- [ ] **100% coverage on `src/core/tasks-json-recovery.ts` is maintained**:
      `npm run test:coverage` GREEN for the file (the snapshot helper's success
      + all-failure branches are exercised).
- [ ] `npm run validate` GREEN; `package.json` `dependencies` byte-identical.

---

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — YES. This PRP names: the exact file
(`src/core/tasks-json-recovery.ts`), the exact branch (PATH B, the corrupt-disk
→ git-restore block starting at the `gitFileHistory` line), the exact insertion
point (before `gitFileHistory`), the exact helper signature
(`snapshotResearchingReadyIds(tasksPath): Promise<readonly string[]>`), the
exact return field (`preservedResearchingReadyIds`), the exact statuses to
capture (`'Researching'`, `'Ready'` — confirmed at `models.ts:175`), the exact
three stale comments to fix (with line numbers), the lenient-extraction
strategy (best-effort `JSON.parse` + DFS for `{id,status}` nodes), and the
exact 5 tests to write.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/core/tasks-json-recovery.ts
  why: THE FILE YOU MODIFY. (1) PATH B is the block starting at `const history =
       await gitFileHistory(relPath, repoPath)` (~line 177). The snapshot read MUST
       be inserted as the FIRST statement of that block (before the git walk). (2)
       The result interface `TasksJsonRecoveryResult` (~lines 48-68) gains the new
       `preservedResearchingReadyIds` field. (3) THREE return sites construct the
       result: PATH A disk (~166), PATH B no-valid-version (~199), PATH B git-restore
       success (~231). PATH A + the PATH C outer-catch (~243) must also set the new
       field (to `[]` and `[]` respectively — see Implementation Blueprint for why
       PATH C uses `[]`). (4) The stale comments "There is NO Ready status" at ~108
       and ~210, plus the module docstring "Researching/Retrying" at ~14, must be
       corrected.
  pattern: PATH B currently (paraphrased):
       const history = await gitFileHistory(relPath, repoPath);
       let restoredBacklog = null; let restoreCommit = null;
       for (const entry of history) { ... find last valid committed version ... }
       if (!restoredBacklog || !restoreCommit) { return { restored:false, source:'disk', reason:'...' }; }
       const written = await withLockedTasksJSON(...);
       return { restored:true, source:'git', reason:`restored from commit ${commit}`, backlog: written };
   S1 inserts, at the top of PATH B:
       const snapshotIds = await snapshotResearchingReadyIds(tasksPath);
   and threads `snapshotIds` into BOTH PATH-B return objects.
  gotcha: PATH B runs ONLY when the working-tree file is NOT schema-valid (that's
          why diskClean is false). So the snapshot read will frequently fail full
          BacklogSchema validation — that's EXPECTED. The helper must NOT use
          BacklogSchema (too strict); it must leniently walk the raw parsed JSON.
  gotcha: the snapshot helper reads the file OUTSIDE the lock. That's intentional
          and safe: it's a pure read, best-effort, never throws, and the real
          mutation happens later inside withLockedTasksJSON. Holding the lock for
          the snapshot read would serialize against the supervisor unnecessarily.

- file: src/core/models.ts   # lines 175-185 (Status type) + 200-210 (StatusEnum)
  why: CONFIRMS `Status` includes BOTH `'Researching'` and `'Ready'`. This is the
       authoritative proof that the stale recovery comments ("There is NO Ready
       status") are WRONG. Also confirms `StatusEnum` (a `z.enum([...])`) can be
       used to cheaply validate a status string via `StatusEnum.safeParse(x).success`,
       OR you can use a plain `new Set(['Researching','Ready']).has(s)`. Prefer the
       Set (no zod import needed in the helper, simpler, and we only care about two
       specific values — we are NOT validating the whole enum).
  pattern: `export type Status = 'Planned' | 'Researching' | 'Ready' | 'Implementing' | 'Retrying' | 'Complete' | 'Failed' | 'Obsolete';`

- file: tests/unit/core/tasks-json-recovery.test.ts
  why: THE TEST FILE YOU MODIFY. (1) The `makeValidBacklog` fixture already
       accepts `s1Status`/`s2Status` overrides — REUSE it (add `s3Status` if you
       need a third item, but two is enough: one Researching + one Ready). (2) The
       existing 'PATH B — preserves Researching status across a git restore' test
       (~line 230) tests INCIDENTAL preservation (committed blob carries it). ADD a
       NEW test for the UNCOMMITTED case: commit S2=Planned, then write working-tree
       S2=Ready, corrupt a DIFFERENT item or rely on the fact that the working tree
       is schema-valid (so PATH A runs!) — WAIT: if the working tree is schema-valid,
       PATH A runs, not PATH B, and PATH A returns []. To force PATH B you MUST make
       the working-tree file schema-INVALID. But you still want the snapshot to
       extract the Ready id. So: write a working-tree file that is schema-invalid in
       a way that does NOT break JSON.parse (e.g. add an extra unknown field, or
       remove a required field from an UNRELATED item, or set an item type to a bogus
       value) BUT still contains the {id,status} nodes you care about. See the test
       design note in Implementation Blueprint. (3) `readTasksJSON` is imported and
       can assert the on-disk state. (4) `findSubtask(backlog, id)` helper exists.
  pattern: to force PATH B with an extractable snapshot, write a working-tree file
           whose JSON parses but fails BacklogSchema — e.g. JSON.stringify an object
           shaped like a backlog but with one subtask missing a required field
           (so validateBacklogState fails → diskClean=false → PATH B), while the
           Researching/Ready subtasks remain well-formed {id,status} nodes. The
           snapshot helper walks the raw JSON, finds them, returns their ids.
  gotcha: do NOT make the working-tree file unparseable JSON in the
          "snapshot captures uncommitted Ready" test — that defeats the snapshot.
          Unparseable JSON is a SEPARATE test (snapshot is []). For the capture test,
          the file must be JSON-parseable but schema-invalid.

- file: src/utils/task-utils.ts   # setItemStatus (line 527), getAllSubtasks (169)
  why: REFERENCE ONLY — do NOT modify. setItemStatus shows the DFS-traversal idiom
       used elsewhere (visit phases→milestones→tasks→subtasks matching id). The
       snapshot helper does a SIMILAR lenient DFS but over a `unknown` parsed JSON
       value (not a typed Backlog), collecting ids where status matches. You MAY
       reuse the traversal shape but not the typed function (it requires a Backlog).
  pattern: snapshotResearchingReadyIds does its own DFS over `unknown` JSON:
       function collect(node, acc) {
         if (node && typeof node === 'object' && typeof node.id === 'string' &&
             (node.status === 'Researching' || node.status === 'Ready')) acc.push(node.id);
         if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v, acc);
       }
   This is robust to missing/extra fields, partial structures, and any nesting depth.

- file: src/core/session-utils.ts   # readTasksJSON
  why: REFERENCE — readTasksJSON does a strict `BacklogSchema.parse`. The snapshot
       helper must NOT use readTasksJSON (too strict for corrupt PATH-B files).
       Instead read the raw bytes with `readFile` from `node:fs/promises` and
       `JSON.parse` directly, catching all errors. readTasksJSON is still used
       elsewhere in the file (the diskClean probe) — leave that as-is.

- file: plan/008_15504f60a0ef/P3M1T4S2/PRP.md
  why: PARALLEL-EXECUTION CONTEXT. P3.M1.T4.S2 (last-resort fallback commit) is
       being implemented in parallel. It touches ONLY src/utils/git-commit.ts and
       its test — NO overlap with tasks-json-recovery.ts. The two tasks are
       independent (different files). Treat S2's PRP as a contract: it does NOT
       modify tasks-json-recovery.ts, so there is no conflict.
```

### Current Codebase tree (relevant slice)

```bash
src/
  core/
    tasks-json-recovery.ts   # MODIFY — add snapshotResearchingReadyIds helper; capture in PATH B; extend result interface; fix stale comments
    models.ts                # READ-ONLY — Status includes 'Ready' (line 175); StatusEnum (200)
    file-lock.ts             # READ-ONLY — withLockedTasksJSON (PATH B uses it; unchanged)
    session-utils.ts         # READ-ONLY — readTasksJSON (strict; snapshot helper must NOT use it)
    state-validator.ts       # READ-ONLY — validateBacklogState (diskClean probe; unchanged)
  utils/
    task-utils.ts            # READ-ONLY — setItemStatus DFS idiom (reference)
  tools/
    git-mcp.ts               # READ-ONLY — gitFileHistory/gitReadFileAtCommit (PATH B walk; unchanged)
tests/
  unit/
    core/
      tasks-json-recovery.test.ts   # MODIFY/ADD — 5 new tests for snapshot capture + edge cases
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/core/tasks-json-recovery.ts
  # MODIFIED:
  #   + interface field: preservedResearchingReadyIds: readonly string[]  (in TasksJsonRecoveryResult)
  #   + async function snapshotResearchingReadyIds(tasksPath: string): Promise<readonly string[]>
  #       (best-effort: readFile + JSON.parse + lenient DFS collecting {id,status==='Researching'|'Ready'} nodes; returns [] on any error; never throws)
  #   + PATH B: const snapshotIds = await snapshotResearchingReadyIds(tasksPath);  (FIRST statement, before gitFileHistory)
  #   + PATH B both return sites: add preservedResearchingReadyIds: snapshotIds
  #   + PATH A return site: add preservedResearchingReadyIds: []
  #   + PATH C outer-catch return site: add preservedResearchingReadyIds: []  (snapshot var not in scope; empty is correct — outer catch means total failure)
  #   ~ FIX 3 stale comments: module docstring (~14), JSDoc (~108), inline (~210): "Researching/Ready" not "Researching/Retrying"; remove "There is NO Ready status"
tests/unit/core/tasks-json-recovery.test.ts
  # MODIFIED:
  #   + 'PATH B — snapshot captures uncommitted Ready id from working tree' (commit Planned, write working-tree Ready, force schema-invalid → PATH B, assert snapshot contains the id)
  #   + 'PATH B — snapshot captures both Researching and Ready ids'
  #   + 'PATH B — snapshot is [] when working-tree file is unparseable garbage'
  #   + 'PATH A — preservedResearchingReadyIds is [] (no revert)'
  #   + 'PATH C — no valid version in history still returns preservedResearchingReadyIds snapshot' (the snapshot was captured before the walk failed)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the snapshot helper MUST read the working-tree FILE, not the orchestrator's
// in-memory baselineBacklog. PRD §5.1 explicitly forbids the in-memory index because it
// "can drift out of sync with the supervisor." opts.baselineBacklog is the PRE-AGENT
// snapshot; the supervisor's latest Ready/Researching write is on DISK, not in memory.
// So: snapshotResearchingReadyIds(tasksPath) reads the file directly.

// CRITICAL: in PATH B the working-tree file is corrupt BY CONSTRUCTION (a schema-valid
// file would have taken PATH A). So the snapshot read will frequently FAIL full
// BacklogSchema validation — that is EXPECTED. Do NOT use readTasksJSON or BacklogSchema.
// Read raw bytes + JSON.parse + lenient DFS over the unknown parsed value.

// CRITICAL: the snapshot helper MUST NEVER throw. PATH B is wrapped in the outer
// non-fatal try/catch, so a throw would be swallowed anyway — but an uncaught throw
// from the helper would mask the real recovery reason and produce a confusing PATH-C
// result. Wrap the entire helper body in try/catch returning [].

// GOTCHA: the snapshot read runs OUTSIDE the lock (before gitFileHistory). This is
// intentional and safe — it's a pure best-effort read. Do NOT wrap it in
// withLockedTasksJSON. The real mutation (restore + delta) happens later, inside the
// lock. Holding the lock for the snapshot read would serialize against the supervisor.

// GOTCHA: PATH A has NO revert, so NO snapshot is needed — return []. (PATH A re-applies
// the delta onto a fresh locked read; Researching/Ready items in the working tree are
// already preserved because PATH A doesn't overwrite disk with a git blob.) Only PATH B
// (git-history restore) risks clobbering the supervisor's uncommitted statuses.

// GOTCHA: the PATH C outer-catch return site (~243) is OUTSIDE the scope of the snapshot
// variable (snapshotIds is declared inside the PATH B block). It MUST set
// preservedResearchingReadyIds: [] — the outer catch means total failure (git threw, etc.),
// and even if a partial snapshot was captured, returning [] is safe (S2 re-applies nothing).
// Do NOT try to hoist snapshotIds to the outer scope just to preserve it in PATH C —
// [] is the correct, defensible value there.

// GOTCHA: 100% coverage is ENFORCED (vitest thresholds 100% on src/**/*.ts). The snapshot
// helper has at minimum two branches: (a) successful extraction (returns ids), (b) read/parse
// error (returns []). BOTH must be tested. If the DFS has a conditional (e.g. "is this node
// an object?"), exercise both sides. The lenient DFS's "node is a string/array/primitive"
// skip-branch should be covered by any realistic backlog parse.

// GOTCHA: when forcing PATH B in the "snapshot captures uncommitted Ready" test, make the
// working-tree file JSON-parseable but BacklogSchema-INVALID — e.g. set one item's `type`
// to 'BogusType', or delete a required field from an UNRELATED item. Keep the
// Researching/Ready items' {id,status} nodes intact so the lenient DFS finds them. Do NOT
// corrupt the JSON syntax itself (that's the separate "unparseable → []" test).

// GOTCHA: StatusEnum.safeParse works but adds a zod import to the helper. A plain
// `new Set(['Researching', 'Ready']).has(status)` is simpler, has no import cost, and is
// sufficient (we only care about two literal values). Prefer the Set.

// GOTCHA: the THREE stale comments say "There is NO Ready status" / "Researching/Retrying".
// models.ts:175 proves Ready exists. Fix all three as part of this task (they directly
// relate to the snapshot feature — a reader implementing the snapshot would be confused
// by comments claiming Ready doesn't exist). Do NOT touch comments unrelated to this.
```

---

## Implementation Blueprint

### Data models and structure

No new exported types beyond one new optional-but-always-populated field on an
existing interface. The snapshot is a plain `readonly string[]`.

```typescript
// src/core/tasks-json-recovery.ts — NEW additions:

/**
 * IDs of items that were `Researching` or `Ready` in the **working-tree**
 * `tasks.json` BEFORE the git-history restore (PATH B), captured so the
 * restore can re-apply them afterward (PRD §5.1, P3.M2.T1.S1).
 *
 * @remarks
 * - Populated ONLY on the PATH-B branches (corrupt-disk → git restore). PATH A
 *   (clean disk) and PATH C (total failure) return `[]`.
 * - Read directly from the working-tree file (NOT an in-memory index — PRD §5.1
 *   forbids depending on a drift-prone index). Best-effort: `[]` when the
 *   working-tree file is unparseable.
 * - Consumed by P3.M2.T1.S2, which re-applies each id gated on filesystem
 *   evidence (`Ready` only if the item's `PRP.md` exists; `Researching` only if
 *   its `research/` directory exists).
 */
// (added to TasksJsonRecoveryResult):
//   readonly preservedResearchingReadyIds: readonly string[];

/**
 * Best-effort snapshot of `Researching`/`Ready` item IDs from the working-tree
 * `tasks.json` (PRD §5.1, P3.M2.T1.S1).
 *
 * @param tasksPath - Absolute path to the tasks.json FILE.
 * @returns The IDs of items whose `status` is `'Researching'` or `'Ready'`,
 *   extracted via a lenient DFS over the raw parsed JSON. `[]` if the file
 *   cannot be read or parsed. NEVER throws.
 *
 * @remarks
 * In PATH B the working-tree file is corrupt by construction (a schema-valid
 * file takes PATH A), so this does NOT use `readTasksJSON`/`BacklogSchema`
 * (too strict). It reads raw bytes, `JSON.parse`s, and walks the parsed value
 * collecting any node with a string `id` whose string `status` is exactly
 * `'Researching'` or `'Ready'`. This survives partial structures, missing
 * fields, and unknown nesting.
 */
async function snapshotResearchingReadyIds(
  tasksPath: string
): Promise<readonly string[]> {
  const targets = new Set(['Researching', 'Ready']);
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (
        typeof obj.id === 'string' &&
        typeof obj.status === 'string' &&
        targets.has(obj.status)
      ) {
        ids.push(obj.id);
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  try {
    const raw = await readFile(tasksPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    visit(parsed);
  } catch {
    // corrupt/unreadable working-tree file — graceful degradation to []
  }
  return ids;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD imports + the snapshotResearchingReadyIds helper to src/core/tasks-json-recovery.ts
  - ADD to the existing `node:fs/promises` import: `readFile` is NOT already imported
    (the file currently imports only from node:path, ./models.js, ./session-utils.js, etc.).
    Check the top of the file: if `import { ... } from 'node:fs/promises'` is absent, ADD
    `import { readFile } from 'node:fs/promises';`. If present, add `readFile` to its
    named-import list.
  - ADD the `snapshotResearchingReadyIds` function (above) in the TYPE DEFINITIONS /
    private-helpers section (e.g. right after the `logger()` setup, before the PUBLIC API
    section). It is module-private (NOT exported) — it's only called internally.
  - NAMING: camelCase function, SCREAMING_SNAKE for any const. The `targets` Set is a
    local const inside the function (or hoist to a module-level const
    `RESEARCH_PRESERVE_STATUSES = new Set(['Researching','Ready'])` if you prefer —
    either is fine; module-level is slightly cleaner and matches the codebase's constant
    conventions).
  - GOTCHA: do NOT import StatusEnum — the Set is sufficient and avoids an unused import
    (which eslint would flag). Do NOT import from zod.
  - VERIFY: npx tsc --noEmit passes (no implicit-any on the `unknown` node param — the
    helper is fully typed).

Task 2: EXTEND TasksJsonRecoveryResult + capture the snapshot in PATH B + thread into returns
  - ADD to the `TasksJsonRecoveryResult` interface (~line 48-68) the field:
      readonly preservedResearchingReadyIds: readonly string[];
    with the JSDoc above. Place it after `backlog?`.
  - IN PATH B, immediately before `const history = await gitFileHistory(relPath, repoPath);`
    (~line 177), ADD:
      // PRD §5.1 / P3.M2.T1.S1: snapshot live Researching/Ready IDs from the
      // working-tree file BEFORE the git-history restore overwrites disk. The
      // working tree is the authoritative copy of what the research supervisor
      // wrote (it may be uncommitted). Best-effort: [] on unparseable files.
      const snapshotIds = await snapshotResearchingReadyIds(tasksPath);
  - THREAD `snapshotIds` into the PATH-B no-valid-version return (~199):
      return {
        restored: false,
        source: 'disk',
        reason: 'recovery failed: no valid version in git history',
        preservedResearchingReadyIds: snapshotIds,
      };
  - THREAD `snapshotIds` into the PATH-B git-restore-success return (~231):
      return {
        restored: true,
        source: 'git',
        reason: `restored from commit ${commit}`,
        backlog: written,
        preservedResearchingReadyIds: snapshotIds,
      };
  - PATH A return (~166): ADD `preservedResearchingReadyIds: [],` (no revert → no snapshot).
  - PATH C outer-catch return (~243): ADD `preservedResearchingReadyIds: [],` (total failure;
    snapshotIds not in scope here; [] is the defensible value — see gotcha).
  - PRESERVE: all other logic — the git walk, the withLockedTasksJSON restore, the
    legitimate-delta application, the diskClean probe, PATH A's RMW. The snapshot is
    purely ADDITIVE (a read before the walk + a new field on returns).
  - GOTCHA: do NOT consume the snapshot for re-application in this task — S2 does that.
    This task ONLY captures and returns it. Do NOT modify withLockedTasksJSON, setItemStatus,
    or the restore logic to use the snapshot.
  - VERIFY: npx tsc --noEmit passes. The new field is required on every return object (TS
    will error if you miss one — use that to find all return sites).

Task 3: FIX the THREE stale "no Ready status" comments
  - MODULE DOCSTRING (~line 14): "preserves items currently in
    `Researching`/`Retrying` status." → "preserves items currently in
    `Researching`/`Ready` status (PRD §5.1)." (Retrying is NOT what the snapshot covers;
    the PRD names Researching + Ready. The incidental Retrying preservation via the committed
    blob is a separate, pre-existing behavior — leave that mention if present elsewhere, but
    the snapshot/snapshot-context comment must say Researching/Ready.)
  - recoverTasksJson JSDoc (~line 106-108): "Preserves items currently in `Researching`
    or `Retrying` status (they are carried forward from the restored version — never dropped
    to `Planned`). There is NO `Ready` status." → "Preserves items currently in
    `Researching` or `Ready` status: the pre-revert snapshot (P3.M2.T1.S1) captures their
    IDs from the working-tree file, and P3.M2.T1.S2 re-applies them afterward gated on
    filesystem evidence. (`Retrying` items are also carried forward from the restored
    version.) `Ready` IS a valid status (models.ts)."
  - Inline comment in PATH B (~line 210, the "Researching/Retrying items are preserved
    automatically (we mutate ONLY the target item)" line): clarify that this incidental
    preservation covers the COMMITTED version's statuses, while the snapshot captures the
    WORKING-TREE (possibly uncommitted) statuses. E.g.: "Items in Researching/Ready that
    were in the COMMITTED version are preserved automatically (we mutate only the target
    item). The working-tree snapshot (captured above) covers statuses the supervisor wrote
    but never committed — S2 re-applies those."
  - PRESERVE: do NOT rewrite unrelated JSDoc. Fix ONLY the three comments that claim Ready
    doesn't exist or that mislabel the snapshot's scope.

Task 4: MODIFY tests/unit/core/tasks-json-recovery.test.ts
  - READ the existing suite + makeValidBacklog fixture first.
  - ADD test: 'PATH B — snapshot captures uncommitted Ready id from working tree':
      * SETUP: commit a baseline with S2 = 'Planned' (commitBacklog(git, dir,
        makeValidBacklog({ s1Status:'Implementing', s2Status:'Planned' }), 'baseline')).
      * Write a working-tree file that is JSON-parseable but BacklogSchema-INVALID, with S2
        = 'Ready'. Strategy: take makeValidBacklog({ s2Status:'Ready' }), then introduce a
        schema violation in an UNRELATED place (e.g. set the phase's `type` to 'BogusType',
        or delete a required field). Write JSON.stringify(it) to the file. The diskClean
        probe (readTasksJSON → BacklogSchema.parse) will THROW → diskClean=false → PATH B.
        The snapshot helper reads raw bytes + JSON.parse + lenient DFS → finds S2's id.
      * EXECUTE: const result = await recoverTasksJson(tasksPath(), { itemId:'P1.M1.T1.S1',
        status:'Complete' }, { repoPath: dir });
      * VERIFY: expect(result.restored).toBe(true); expect(result.source).toBe('git');
        expect(result.preservedResearchingReadyIds).toContain('P1.M1.T1.S2');
        (the committed version had S2=Planned; the working tree had Ready; the snapshot
        captured the working-tree value — proving the snapshot is from the FILE, not memory.)
  - ADD test: 'PATH B — snapshot captures both Researching and Ready ids':
      * Extend makeValidBacklog (or inline a fixture) to have a third subtask S3 in
        'Researching' and S2 in 'Ready'. Commit a clean baseline, then write a
        schema-invalid working tree (same violation trick) preserving both ids.
      * VERIFY: expect(result.preservedResearchingReadyIds).toEqual(
          expect.arrayContaining(['P1.M1.T1.S2', 'P1.M1.T1.S3']));
  - ADD test: 'PATH B — snapshot is [] when working-tree file is unparseable garbage':
      * Commit a baseline. Write truncated garbage ('{ "trun') to working tree.
      * EXECUTE recovery.
      * VERIFY: expect(result.preservedResearchingReadyIds).toEqual([]);
        (graceful degradation; no throw; result.restored is still true because git history
        has the valid committed version to restore.)
  - ADD test: 'PATH A — preservedResearchingReadyIds is []':
      * (Modify the existing PATH A test OR add a new one.) Commit clean, leave working tree
        clean (schema-valid). Run recovery with a delta.
      * VERIFY: expect(result.restored).toBe(false); expect(result.source).toBe('disk');
        expect(result.preservedResearchingReadyIds).toEqual([]);
  - ADD test: 'PATH C — no valid version in history still returns the captured snapshot':
      * Commit NOTHING (empty repo). Write a working-tree file that is JSON-parseable +
        schema-invalid (so diskClean=false → PATH B) AND contains a Ready id, but since
        there's no committed history, the walk finds nothing → the PATH-B no-valid-version
        return runs.
      * EXECUTE recovery.
      * VERIFY: expect(result.restored).toBe(false);
        expect(result.reason).toMatch(/no valid version in git history/);
        expect(result.preservedResearchingReadyIds).toContain('P1.M1.T1.S2');
        (proves the snapshot was captured BEFORE the walk, even when recovery itself fails.)
  - PRESERVE: all existing tests unchanged (except PATH A, which you may augment with the
    preservedResearchingReadyIds:[] assertion — or add a separate test). The existing
    'PATH B — preserves Researching status across a git restore' test STILL passes
    (incidental preservation via committed blob is unchanged behavior).
  - GOTCHA: the schema-violation trick is the crux of the capture tests. If
    validateBacklogState does not FAIL on your violation, diskClean stays true and PATH A
    runs (snapshot []). Read state-validator.ts to pick a violation it actually rejects.
    Safe choices: set `type` to a value not in ItemTypeEnum, or delete a required
    subtask field like `story_points`/`context_scope`. Verify with a quick console check
    if unsure: validateBacklogState(yourInvalidBacklog).isValid === false.

Task 5: VALIDATE
  - RUN: npx tsc --noEmit -p tsconfig.json
  - RUN: npx eslint src/core/tasks-json-recovery.ts
  - RUN: npx prettier --check src/core/tasks-json-recovery.ts tests/unit/core/tasks-json-recovery.test.ts
  - RUN: npx vitest run tests/unit/core/tasks-json-recovery.test.ts -v
  - RUN: npx vitest run --coverage src/core/tasks-json-recovery.ts   # CONFIRM 100%
  - RUN: npm run validate
  - EXPECT: GREEN. If red:
    * TS error "Property 'preservedResearchingReadyIds' is missing" → you missed a return
      site (PATH A, PATH B ×2, or PATH C). Add the field to every TasksJsonRecoveryResult
      literal.
    * coverage < 100% → a snapshot helper branch (read/parse error → []) or a return path
      is untested. Add the missing test.
    * "readFile is not defined" → forgot the node:fs/promises import.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the snapshot helper (lenient DFS over unknown JSON). Robust to any shape.
async function snapshotResearchingReadyIds(
  tasksPath: string
): Promise<readonly string[]> {
  const targets = new Set(['Researching', 'Ready']);
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (
        typeof obj.id === 'string' &&
        typeof obj.status === 'string' &&
        targets.has(obj.status)
      ) {
        ids.push(obj.id);
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  try {
    const raw = await readFile(tasksPath, 'utf-8');
    visit(JSON.parse(raw));
  } catch {
    // unreadable / unparseable → []
  }
  return ids;
}

// PATTERN: PATH B insertion point (the snapshot is the FIRST statement).
// ---- PATH B: corrupt disk → walk git history for the last valid version ----
// PRD §5.1 / P3.M2.T1.S1: snapshot live Researching/Ready IDs from the
// working-tree file BEFORE the git-history restore overwrites disk.
const snapshotIds = await snapshotResearchingReadyIds(tasksPath);
const history = await gitFileHistory(relPath, repoPath);
// ... rest of PATH B unchanged ...

// CRITICAL INVARIANTS:
// 1. The snapshot read is BEST-EFFORT and never throws (entire body in try/catch).
// 2. The snapshot reads the FILE (not in-memory baselineBacklog) — PRD §5.1 forbids
//    the in-memory index.
// 3. The snapshot runs OUTSIDE the lock (pure read; the mutation is later, in the lock).
// 4. The snapshot is captured BEFORE gitFileHistory (the walk that leads to overwriting).
// 5. The snapshot is returned in BOTH PATH-B return sites (success + no-valid-version).
// 6. PATH A and PATH C return [] (no revert in A; total failure in C).
// 7. This task does NOT re-apply the snapshot — S2 does, gated on FS evidence.
```

### Integration Points

```yaml
RECOVERY UTILITY:
  - modify: src/core/tasks-json-recovery.ts
  - new field: TasksJsonRecoveryResult.preservedResearchingReadyIds (readonly string[])
  - new helper: snapshotResearchingReadyIds(tasksPath) — module-private, best-effort
  - insertion: PATH B, before gitFileHistory
  - consumed (internally): none yet (S2 will consume the result field)
  - untouched: PATH A logic, PATH B git-walk/restore/withLockedTasksJSON, PATH C,
    models.ts, file-lock.ts, task-utils.ts, session-utils.ts, state-validator.ts, git-mcp.ts

NO CONFIG CHANGES:
  - work item: "DOCS: none — no user-facing/config/API surface change"
  - no new constants.ts entries, no .env.example edit, no docs/CONFIGURATION.md edit

NO ORCHESTRATOR CHANGES:
  - callers of recoverTasksJson (task-orchestrator.ts) are unaffected — the new field is
    additive; existing callers that don't read it stay valid (TypeScript structural typing).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing tasks-json-recovery.ts - fix before proceeding
npx tsc --noEmit -p tsconfig.json            # typecheck (catches missing return-site fields, implicit any)
npx eslint src/core/tasks-json-recovery.ts
npx prettier --check src/core/tasks-json-recovery.ts tests/unit/core/tasks-json-recovery.test.ts

# Project-wide validation (the canonical gate)
npm run validate

# Expected: Zero errors. If errors exist, READ output and fix before proceeding.
# Common: "Property 'preservedResearchingReadyIds' is missing in type ..." → you missed a
#   return-site object literal. Add the field to ALL four return sites (PATH A, PATH B ×2,
#   PATH C).
# Common: format:check fails → npx prettier --write on the modified files.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Modified recovery (PATH B snapshot paths)
npx vitest run tests/unit/core/tasks-json-recovery.test.ts -v

# Full core suite (no regressions in PATH A / PATH C / existing PATH B tests)
npx vitest run tests/unit/core/ -v

# CRITICAL: confirm 100% coverage on tasks-json-recovery.ts (project enforces 100%)
npx vitest run --coverage src/core/tasks-json-recovery.ts

# Expected: All tests pass AND coverage on src/core/tasks-json-recovery.ts is 100%.
# If coverage < 100%: the snapshot helper's read/parse-error branch (→ []) is untested,
#   OR a return path (PATH A [], PATH C []) is untested. Add the missing test.
# Common test bug: the schema-violation trick didn't actually fail validateBacklogState
#   → diskClean stayed true → PATH A ran → snapshot []. Verify your invalid fixture with
#   validateBacklogState(invalid).isValid === false BEFORE writing the file.
```

### Level 3: Integration Testing (System Validation)

```bash
# The existing tests/integration/core/tasks-json-recovery-e2e.test.ts uses REAL tmpdir + REAL
# git. Run it to confirm no regression:
npx vitest run tests/integration/core/tasks-json-recovery-e2e.test.ts -v

# (No service to start — this is a recovery-utility change. The e2e test exercises the real
#  git walk + restore path with real corruption, confirming the snapshot is captured in a
#  realistic setting.)
# Expected: e2e GREEN. If the e2e asserts the exact shape of TasksJsonRecoveryResult, it may
#   need the new field added — but additive fields rarely break structural assertions. Check.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This task has no web/Docker/DB/performance surface — it's a best-effort pre-revert
#  snapshot over an existing recovery routine. The domain-specific validation is the unit
#  tests asserting: snapshot captured from working tree (not memory); snapshot [] on
#  unparseable; snapshot in both PATH-B returns; PATH A/C return [].)

# Optional: manual reasoning check — construct a scenario where the supervisor wrote Ready
# to disk (uncommitted), an agent truncated the file, and recovery runs. Confirm via the
# 'PATH B — snapshot captures uncommitted Ready id' test that the snapshot contains the id
# even though git HEAD has it Planned. This is the core PRD §5.1 guarantee.
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

- [ ] `TasksJsonRecoveryResult.preservedResearchingReadyIds: readonly string[]` field exists
- [ ] `snapshotResearchingReadyIds(tasksPath)` helper exists, best-effort, never throws
- [ ] PATH B captures the snapshot before `gitFileHistory`
- [ ] Both PATH-B return sites (success + no-valid-version) include the snapshot
- [ ] PATH A returns `preservedResearchingReadyIds: []`
- [ ] PATH C outer-catch returns `preservedResearchingReadyIds: []`
- [ ] Snapshot reads the FILE (not in-memory `baselineBacklog`) — proven by the
      uncommitted-Ready test
- [ ] Snapshot is `[]` on unparseable working-tree file (graceful degradation)
- [ ] Snapshot captures both `Researching` and `Ready` ids
- [ ] The three stale "no Ready status" comments are corrected
- [ ] PATH A / PATH C / existing PATH-B-incidental-preservation tests unchanged
- [ ] The git-walk, restore, `withLockedTasksJSON`, and delta-application logic unchanged

### Code Quality Validation

- [ ] Snapshot helper uses lenient DFS over `unknown` (no strict `BacklogSchema`)
- [ ] Snapshot helper is module-private (not exported — only called internally)
- [ ] No new dependencies (`package.json` `dependencies` byte-identical)
- [ ] JSDoc on the new field + helper cites PRD §5.1, P3.M2.T1.S1, and the S2 consumer
- [ ] No new config/docs surface (work item: "DOCS: none")
- [ ] The "snapshot must come from working-tree file, not in-memory" PRD requirement is
      satisfied and documented in a code comment

### Documentation & Deployment

- [ ] Code is self-documenting with clear variable/function names
- [ ] The corrected comments prevent future readers from re-introducing the "no Ready
      status" confusion
- [ ] The contract handoff to S2 (the `preservedResearchingReadyIds` field) is documented
      in the field's JSDoc

---

## Anti-Patterns to Avoid

- ❌ Don't read the snapshot from the in-memory `opts.baselineBacklog` — it's the
  PRE-AGENT snapshot and predates the supervisor's latest write. Read the FILE.
- ❌ Don't use `readTasksJSON`/`BacklogSchema` in the snapshot helper — the PATH-B
  working-tree file is corrupt by construction; the strict parse will throw. Use raw
  `readFile` + `JSON.parse` + lenient DFS.
- ❌ Don't make the snapshot helper throw — wrap the whole body in try/catch returning
  `[]`. A throw would be swallowed by PATH B's outer catch and mask the real recovery
  reason with a confusing PATH-C result.
- ❌ Don't wrap the snapshot read in `withLockedTasksJSON` — it's a pure best-effort
  read; holding the lock serializes against the supervisor unnecessarily. The real
  mutation is later, inside the lock.
- ❌ Don't capture the snapshot AFTER `gitFileHistory` — the walk is what leads to
  overwriting disk. Capture BEFORE it (first statement of PATH B).
- ❌ Don't consume/re-apply the snapshot in this task — S2 does that (gated on FS
  evidence). This task ONLY captures and returns it.
- ❌ Don't forget PATH A and PATH C return sites — every `TasksJsonRecoveryResult`
  literal must include `preservedResearchingReadyIds` (TypeScript will enforce this).
- ❌ Don't hoist `snapshotIds` to outer scope just to populate PATH C — `[]` is the
  correct defensible value for total failure.
- ❌ Don't forget the schema-violation trick in the capture tests — a schema-valid
  working tree takes PATH A, not PATH B. Verify
  `validateBacklogState(invalid).isValid === false` before writing the test fixture.
- ❌ Don't import `StatusEnum`/zod into the helper — a plain `Set<string>` of two
  literals is simpler and avoids an unused-import lint warning.
- ❌ Don't modify `models.ts`, `file-lock.ts`, `task-utils.ts`, `state-validator.ts`,
  `session-utils.ts`, or `git-mcp.ts`. This task touches ONLY
  `tasks-json-recovery.ts` + its test.
- ❌ Don't add config/env/docs surface — the work item explicitly says "DOCS: none."
- ❌ Don't skip the coverage check — the project ENFORCES 100% on `src/**/*.ts`. The
  snapshot helper's success + error branches AND all four return paths must be exercised.