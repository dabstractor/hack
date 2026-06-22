# Recovery Routine Design Notes — P5.M2.T1.S2

Verified facts from the codebase that shape the `recoverTasksJson` design.

## 1. API shape mismatches that MUST be bridged

The contract passes a **`tasksPath`** (path to the `tasks.json` *file*), but the
session-utils primitives it tells us to reuse take a **session directory**:

| Primitive | Takes | Resolves |
|-----------|-------|----------|
| `readTasksJSON(sessionPath)` | session **dir** | `resolve(sessionPath, 'tasks.json')` |
| `writeTasksJSON(sessionPath, backlog)` | session **dir** | `resolve(sessionPath, 'tasks.json')` |
| `gitFileHistory(filePath, repoPath?)` | **repo-relative** file path | `git.log({ file })` |
| `gitReadFileAtCommit(filePath, commit, repoPath?)` | **repo-relative** file path | `git show <commit>:<path>` |

Therefore `recoverTasksJson` MUST derive two paths from `tasksPath`:
- `sessionDir = dirname(tasksPath)` → for `readTasksJSON` / `writeTasksJSON`
- `relPath = relative(repoPath ?? cwd, tasksPath)` → for the git primitives

Source: `src/core/session-utils.ts` (`readTasksJSON`/`writeTasksJSON`), S1 PRP
(`gitFileHistory`/`gitReadFileAtCommit`/`gitRestoreFile` signatures).

## 2. The corruption signal = `readTasksJSON` THROWS

`readTasksJSON` does BOTH `JSON.parse` AND `BacklogSchema.parse` (Zod). It throws
`SessionFileError` on:
- read failure (ENOENT)
- JSON parse failure (truncated write / partial edit)
- Zod schema failure (schema-invalid mutation)

So a single `try { readTasksJSON(dir) } catch` is the parse/validate gate. The
contract's "(validateBacklogState.isValid)" is a SECONDARY gate for orphaned/circular
deps on an otherwise-schema-valid file — call it on success and route `!isValid`
into the same git-restore path.

## 3. Status enum has NO `Ready` (confirmed)

`src/core/models.ts`: `Status = 'Planned' | 'Researching' | 'Implementing' |
'Retrying' | 'Complete' | 'Failed' | 'Obsolete'`. PRD §5.1 says "Researching or
Ready" but `Ready` does not exist — the research queue tracks readiness via its
internal `results` Map, NOT a status value. **Preserve `Researching` and `Retrying`
across a restore; never reset them to `Planned`.** (system_context.md, models.ts)

## 4. Why `opts.baselineBacklog` is REQUIRED to "discard unauthorized mutations"

The contract test list includes: *"unauthorized agent mutation of an unrelated item
is discarded"* as a DISTINCT case from *"truncated/invalid JSON → restore"*. That
means it is a **clean-disk** scenario (file parses + validates) where an agent
changed an unrelated item's status. To discard it we need the **pre-agent baseline**
to reconstruct from.

The orchestrator HAS this baseline: `refreshBacklog()` snapshots
`sessionManager.currentSession.taskRegistry` into `#backlog` (implementation_notes.md
§6). S3 will pass it via `opts.baselineBacklog`.

- **Clean-disk path**: reconstruct from `baselineBacklog` (clone → apply legitimate
  delta → write). The disk content is ignored for reconstruction, so ALL agent
  mutations are discarded; only the legitimate status delta survives.
- **Restore path**: the git-restored valid version is the reconstruction base (the
  contract does NOT mention a baseline here) → apply legitimate delta → preserve
  Researching/Retrying already present in the restored version.
- If `baselineBacklog` is omitted, fall back to the disk-read backlog as the base
  (the legitimate delta still applies; unrelated mutations can't be detected without
  a baseline — documented degradation).

## 5. readonly models → mutate via cast (existing idiom)

All model fields are `readonly`. The existing repair functions in
`state-validator.ts` already mutate via cast: `(item as { dependencies: string[] }).dependencies = ...`.
Use the same idiom for status: `(item as { status: Status }).status = newStatus`.
Deep-clone first via `structuredClone()` (Node 20+) so the caller's objects are
untouched. Provide an internal `setItemStatus(backlog, itemId, status)` walker
(Phase→Milestone→Task→Subtask) mirroring the traversal in state-validator.

## 6. Non-fatal contract — NEVER throw to the caller

Contract LOGIC (3): *"on total failure to recover, log an error and leave state
as-is (never throw to terminate the session)."* Wrap EVERYTHING in an outer
try/catch; on any unhandled error, log + return a typed `{ restored:false, source:'disk',
reason:'...' }`. The orchestrator (S3) treats the result as best-effort observability.

## 7. Restore-path detail (git walk)

1. `gitFileHistory(relPath, repoPath)` → newest-first `{commit,date}[]`.
2. For each entry: `gitReadFileAtCommit(relPath, commit, repoPath)` → blob string.
3. `try { JSON.parse(blob) → BacklogSchema.parse → validateBacklogState }`. On the
   FIRST version that parses+validates (schema-valid at minimum), use it.
4. Reconstruct: `structuredClone(restored)` → `setItemStatus(itemId, legitimateStatus)`.
   Researching/Retrying items in the restored version are preserved automatically
   (we only mutate the target item). Write via `writeTasksJSON`.
5. Return `{ restored:true, source:'git', reason:'restored from <commit>' }`.
6. If NO valid version found in history → log + non-fatal return (leave state).

## 8. Test strategy: REAL tmpdir + REAL git (honest), per contract

Contract MOCKING: *"Use an ephemeral tmpdir with a real git repo (init, commit
valid tasks.json, then corrupt on disk) for honest recovery tests; or stub
readTasksJSON/git primitives."* Prefer the **real** approach — it exercises
`gitFileHistory`/`gitReadFileAtCommit` + real `readTasksJSON`/`writeTasksJSON` +
`atomicWrite` end-to-end. Use `simpleGit(dir)` (or child_process `git init`) to
make a repo, `gitRestoreFile`/`writeTasksJSON` to seed a valid committed
`tasks.json`, then corrupt on disk. NO `vi.mock('simple-git')` in this file
(unlike git-mcp.test.ts which mocks it module-wide) — we want the REAL git ops.
node:fs/promises is NOT mocked here, so atomicWrite writes for real. Provide a
minimal valid Backlog fixture (one Phase>Milestone>Task>2 Subtasks) so Zod passes.

## 9. Docs = Mode A, edits docs/ARCHITECTURE.md (in scope for S2)

Contract DOCS line: `[Mode A] Document the smart-recovery behavior in
docs/ARCHITECTURE.md state-management section`. Insert a new subsection
"`### tasks.json Protection & Smart Recovery`" AFTER "`### State Persistence
Patterns`" (which ends at the "Atomic Persistence" bullets, before the `---` at
~line 701). Plus JSDoc on `recoverTasksJson`. NOT deferred to P5.M3.

## 10. No constants.ts / env change for R4

`recoverTasksJson` takes `opts`, not env vars. R4 adds no new config constants
(R1/R2 already added RESEARCH_TIMEOUT/ISSUE_RETRY_MAX). Do NOT touch constants.ts.

## 11. Sibling (S1) contract — exact signatures to import

From the S1 PRP (treat as contract). All THROW on failure; consume via try/catch:
```ts
gitFileHistory(filePath: string, repoPath?: string): Promise<GitFileHistoryEntry[]>
  // GitFileHistoryEntry = { commit: string; date: string }; newest-first; [] on no-history
gitReadFileAtCommit(filePath: string, commit: string, repoPath?: string): Promise<string>
gitRestoreFile(filePath: string, commit?: string, repoPath?: string): Promise<void>
```
S2 consumes `gitFileHistory` + `gitReadFileAtCommit` (does NOT need `gitRestoreFile`
— the recovery writes its own reconstructed backlog via `writeTasksJSON`, not a raw
blob restore, so it can layer the delta + preserved statuses).
