# Working-Tree Snapshot Design — P3.M2.T1.S1

## The core problem

PRD §5.1 line 187 mandates:

> "Preserve background-research status (snapshot before revert): Items marked
> `Researching` or `Ready` by the background research queue must survive a
> restore. To do this reliably, the restore logic snapshots the live
> `Researching`/`Ready` item IDs from the **working-tree `tasks.json` before**
> the git revert (the authoritative copy of what the research supervisor
> actually wrote), then re-applies them afterward gated on **filesystem
> evidence** … This must not depend on an in-memory index that can drift out of
> sync with the supervisor."

## Why the CURRENT code is insufficient

`recoverTasksJson` PATH B currently restores the last valid **committed**
version from git history and re-applies only the legitimate delta. It "preserves
Researching" only **incidentally** — it relies on the *committed* git blob
already carrying those statuses. Two failure modes:

1. The background supervisor wrote `Researching`/`Ready` to the **working-tree**
   `tasks.json` but those changes were **never committed** (the supervisor does
   not run `git add`/`git commit` — only the orchestrator's Smart Commit does).
   So the committed blob the restore picks up has those items at `Planned`, and
   the in-flight research status is **silently lost** on recovery.
2. The supervisor and the orchestrator interleave writes; the authoritative copy
   of "what the supervisor actually wrote" is the working-tree file, NOT any
   in-memory index (which the PRD explicitly forbids depending on, because it
   can drift).

## This task (S1): snapshot BEFORE the revert

S1's job is to **read the working-tree `tasks.json` and snapshot the IDs of
items in `Researching` and `Ready` status BEFORE PATH B's git-history
restore/revert overwrites disk**. S2 (the sibling) consumes the snapshot and
re-applies the statuses gated on filesystem evidence (PRP.md / research/ dir
existence).

### Where the snapshot must happen

PATH B begins after the `diskClean` probe fails. The snapshot must be taken:
- **AFTER** the `diskClean = false` determination (we're committing to PATH B)
- **BEFORE** `gitFileHistory(relPath, repoPath)` (the git walk is the first
  step that leads toward overwriting disk)

So: insert the snapshot at the top of the PATH B block, right before the
`history = await gitFileHistory(...)` line.

### Why read the working-tree file directly (not the orchestrator's in-memory backlog)

The PRD forbids depending on an in-memory index ("can drift out of sync with
the supervisor"). The orchestrator's `opts.baselineBacklog` is the
**pre-agent** snapshot — it predates the supervisor's most recent write, so it
may not include items the supervisor flipped to `Researching`/`Ready` after the
agent run started. The **working-tree file** is the authoritative copy of "what
the supervisor actually wrote." Even though disk may be corrupt, we do a
**best-effort lenient read**: try to parse + validate; if that fails, try a
looser traversal; if everything fails, the snapshot is simply empty (graceful
degradation — S2 re-applies nothing, which is the pre-S1 behavior).

### Lenient extraction strategy

The working-tree file may be:
- (a) **Parseable + schema-valid** → but then `diskClean` would have been true
  and we'd be in PATH A. So in PATH B the file is by construction NOT
  schema-valid. However it may still be:
- (b) **Parseable JSON but schema-invalid** (e.g. a valid JSON object missing
  some required fields, or a backlog with one malformed subtask). We can walk
  the parsed object's tree leniently with a hand-rolled DFS that reads
  `{id, status}` pairs from any `{type, id, status, ...}`-shaped nodes, without
  requiring the full `BacklogSchema`.
- (c) **Unparseable** (truncated/garbage) → snapshot is empty.

Strategy: `JSON.parse` the raw file bytes (best-effort try/catch). If it parses,
walk the object looking for any node with a string `id` and a string `status`
that is `'Researching'` or `'Ready'`, collecting the ids. Use `StatusEnum`
(`z.enum([...])`) to validate the status string cheaply, or a simple
`Set<string>` membership check.

### Return shape

The snapshot must be consumable by S2. Return it in the
`TasksJsonRecoveryResult` so the caller (and S2's logic) can access it. Proposed
addition to the result interface:

```ts
export interface TasksJsonRecoveryResult {
  // ...existing fields...
  /**
   * IDs of items that were `Researching` or `Ready` in the working-tree
   * tasks.json BEFORE the git restore (PATH B). Captured so the restore can
   * re-apply them afterward (PRD §5.1, P3.M2.T1.S2). Empty when (a) PATH A ran
   * (no revert), (b) PATH B ran but the working-tree file was unparseable, or
   * (c) no items held those statuses. Always an array (never undefined).
   */
  readonly preservedResearchingReadyIds?: readonly string[];
}
```

Use `readonly string[]` (always defined as `[]` when empty — avoid `undefined`
so callers don't need a null check; but mark optional `?` in the interface for
back-compat with existing literal construction). **Decision: always populate
with `[]` (never undefined).** The `?` is kept only so existing call sites that
don't read it stay valid.

### Key files

- `src/core/tasks-json-recovery.ts` — MODIFY: add snapshot step in PATH B;
  extend `TasksJsonRecoveryResult`.
- `tests/unit/core/tasks-json-recovery.test.ts` — MODIFY/ADD: tests that the
  snapshot is captured from working tree, is empty on unparseable, excludes
  PATH A.
- `src/core/models.ts:175` — READ: `Status` includes `'Researching'` and
  `'Ready'` (confirms the stale code comments "There is NO Ready status" are
  WRONG).

### Stale comments to fix

The recovery file has THREE stale comments claiming "There is NO Ready status"
(lines 108, 210 area) and the module docstring says "preserves … `Researching`
/`Retrying`" (omits Ready). These contradict `models.ts:175`. S1 should update
these comments to reflect that `Ready` IS a valid status (PRD §5.1 line 187
names both `Researching` and `Ready`).

## Contract handoff to S2

S2 will: after the restore write, iterate `preservedResearchingReadyIds`, and
for each id set it to `Ready` only if `plan/.../{id}/PRP.md` exists, else
`Researching` only if `plan/.../{id}/research/` exists. S1 only produces the
raw id list — S2 adds the filesystem gating.