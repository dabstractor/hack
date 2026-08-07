# System Context — Session 012

> High-level architecture map for downstream PRP agents. Read this before
> implementing any subtask.

## Two independent features, one changeset

This delta adds **two orthogonal features** that share no code path:

1. **Commit Message Style Layer** — extends the stagecoach commit-message
   generation pipeline (Feature 1, PRD §5.1).
2. **Manual Status Updates (`hack update`)** — a new CLI subcommand for
   manually rewriting task statuses (Feature 2, PRD §5.4).

Plus a **Mode B documentation sweep** (Feature 3).

---

## Feature 1 — Call graph & integration points

```
smartCommit()                              [src/utils/git-commit.ts]
  └─ generateCommitMessage(diff)           [src/utils/git-commit.ts]
       ├─ getPrpCommitStyle()              [src/config/constants.ts] ← NEW
       ├─ getPrpCommitStyleExamples()      [src/config/constants.ts] ← NEW
       ├─ getRecentCommitMessages(n)       [src/tools/git-mcp.ts]    ← NEW
       ├─ buildCommitMessageSystemPrompt() [src/agents/commit-message-agent.ts] ← NEW
       └─ createCommitMessageAgent(system) [src/agents/commit-message-agent.ts] ← MODIFIED
  └─ formatCommitMessage(msg, position)    [src/utils/git-commit.ts] (UNCHANGED — position layer)
```

**Key boundary:** `formatCommitMessage` is the **position layer** and is
**completely unchanged**. The style layer only affects what the agent emits as
the descriptive message — `formatCommitMessage` still layers the
`task-prefix`/`plain` prefix and `Co-Authored-By` trailer afterward.

**Config flow:**
```
.hack [pipeline] commit_style        ──┐
                                      ├─→ process.env.PRP_COMMIT_STYLE ──→ getPrpCommitStyle()
shell export PRP_COMMIT_STYLE        ──┘
```

---

## Feature 2 — Call graph & integration points

```
hack update <id> <status>                [src/cli/index.ts] ← NEW COMMAND
  ├─ File discovery (mirrors taskAction)  [src/cli/index.ts] (reuse pattern)
  ├─ normalizeTaskId(looseId)            [src/utils/task-utils.ts] ← NEW
  ├─ findItemByLooseId(backlog, id)      [src/utils/task-utils.ts] ← NEW
  ├─ matchStatus(looseStatus)            [src/utils/task-utils.ts] ← NEW
  └─ withLockedTasksJSON(dir, (backlog) => {
       ├─ cascadeCompleteDown(item)      [src/utils/task-utils.ts] ← NEW
       └─ recomputeAncestorsUp(backlog)  [src/utils/task-utils.ts] ← NEW
     })                                  [src/core/file-lock.ts] (reuse — unchanged)
```

**Key boundary:** The existing `promoteIfAllComplete` + `rollupCompletion` in
`task-utils.ts` are **monotonic promote-to-Complete-only** and are used by the
orchestrator. The new cascade functions are **strictly richer** (downward
Complete cascade + bottom-up minimum-status recompute that CAN downgrade
ancestors). Do NOT modify the existing monotonic functions.

**Lock contract:** `hack update` uses `withLockedTasksJSON` (from
`src/core/file-lock.ts`) — the SAME lock as the orchestrator. This guarantees
serialized RMW, atomic write (temp + rename), and never corrupts tasks.json.

---

## Shared infrastructure (reused, NOT modified)

| Component | File | Purpose |
|-----------|------|---------|
| `withLockedTasksJSON` | `src/core/file-lock.ts` | Serialized RMW of tasks.json |
| `writeTasksJSON` | `src/core/session-utils.ts` | Atomic write + schema validation |
| `readTasksJSON` | `src/core/session-utils.ts` | Read + parse tasks.json |
| `findLatestBugfixTasksFile` | `src/core/session-utils.ts` | Bugfix-child discovery |
| `SessionManager.findLatestSession` | `src/core/session-manager.ts` | Latest session discovery |
| `StatusEnum` / `BacklogSchema` | `src/core/models.ts` | Zod validation schemas |
| `formatCommitMessage` | `src/utils/git-commit.ts` | Position layer (UNCHANGED) |
| `simpleGit` | `src/tools/git-mcp.ts` | Git operations via simple-git |
| `validateRepositoryPath` | `src/tools/git-mcp.ts` | Repo path validation |