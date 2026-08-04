# BUG-003 — Task-prefix commit format + PRP_COMMIT_FORMAT (PRD §5.1)

**Severity:** Major · **Status:** confirmed unimplemented against HEAD `727db29`

## Root cause (verified)
`formatCommitMessage(message)` (`src/utils/git-commit.ts:108-110`) unconditionally returns:
```
`[PRP Auto] ${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`
```
— prepending the exact banner PRD §5.1 (`PRD.md:212-229`) forbids. Every commit routes through
it (stagecoach happy path `:489`, fallback `:496`, default path `:500`). `PRP_COMMIT_FORMAT`
has **zero** matches in `src/`; there is no task-prefix builder, no trailing-level elision.

## PRD §5.1 requirements (verbatim, `PRD.md:212-229` + config table `:420-421`)
- Format: `<phase>.<milestone>.<task>.<subtask>: <descriptive message>` (1-indexed position).
  Example: `1.2.1.1: add createDeferredPromise utility and utils barrel`.
- **Elide trailing unused levels** (e.g. a Task-level item with no subtask → `1.2.1`, never `1.2.1.0`).
- The prefix **replaces** decoration — `[PRP Auto]` banner and Conventional-Commit scope
  (`feat(P1.M2.T2.S1): …`) MUST NOT be prepended. "The descriptive message is the LLM-generated
  summary, kept verbatim — only the decoration is stripped."
- **Non-task commits carry no prefix** (initial commit, fallback, scaffolding) → degrade to plain.
- **Bugfix sessions use their own numbering** (never the parent session's indices).
- `PRP_COMMIT_FORMAT=task-prefix` (DEFAULT) | `PRP_COMMIT_FORMAT=plain` (opt-out, no prefix).
- When `task-prefix` selected but commit is not a backlog item → degrade to `plain`.
- Toggling affects only newly generated messages; existing history is never rewritten.

**Note on `Co-Authored-By` trailer:** §5.1's forbidden-banner statement names `[PRP Auto]` and
Conventional-Commit **scope** but is SILENT on the trailer. The §5.1 format spec concerns the
**subject line**; a trailer is a separate body/footer component. **Decision: PRESERVE the
`Co-Authored-By: Claude <noreply@anthropic.com>` trailer** (append after a blank line) in both
modes — it is not forbidden, and removing it is a separate product concern. Only the
`[PRP Auto]` banner is removed. Flag in the commit message.

## Call sites (verified — only 2 files call `smartCommit`)
| # | Site | message (fallback) | options | Backlog item? |
|---|------|--------------------|---------|---------------|
| 1 | `task-orchestrator.ts:801` | `${subtask.id}: ${subtask.title} (skip-recovery…)` | `{generateMessage:true}` | ✅ subtask |
| 2 | `task-orchestrator.ts:1061` | `${subtask.id}: ${subtask.title}` | `{generateMessage:true}` | ✅ subtask |
| 3 | `task-orchestrator.ts:1113` | `'cleanup: doc reorganization'` | `{generateMessage:true}` | ❌ non-backlog |
| 4 | `bug-hunt-workflow.ts:503` | `'chore(qa): bug hunt clean…'` | (default path) | ❌ non-backlog |

`subtask.id` format = `P{p}.M{m}.T{t}.S{s}` (regex `src/core/models.ts:353`). There are **no**
separate numeric index fields — the position is encoded ONLY in the string id. Sites #1/#2 use
`generateMessage:true`, so `message` is only a fallback; the **committed** message is the LLM
output (currently no prefix). To build the prefix, `smartCommit` must receive the implementing
item's position/id as a NEW option. Sites #3/#4 are non-backlog → must signal "no prefix".

## Stagecoach prompt (`src/agents/commit-message-agent.ts:69-77`)
`COMMIT_MESSAGE_SYSTEM` currently instructs Conventional Commits ("Type prefix: feat, fix…";
"If a work-item id appears in changed paths, reference it in the subject"). The §5.1 example
`1.2.1.1: add createDeferredPromise utility and utils barrel` has NO type/scope — the
task-prefix carries categorization. The prompt must be relaxed so the agent emits a **plain
descriptive imperative summary** (no Conventional-Commit type, no `(P-id)` scope); the
task-prefix is layered on by the caller. The agent's existing "Do NOT include [PRP Auto]/
Co-Authored-By" hard rule stays valid.

## Fix design

### S1 — config (Mode A docs: update `docs/CONFIGURATION.md`)
In `src/config/constants.ts`, following the `COMMIT_RETRY_MAX` triple / `getValidationAgent`
string-getter pattern:
```
export const PRP_COMMIT_FORMAT = 'PRP_COMMIT_FORMAT';
export const DEFAULT_PRP_COMMIT_FORMAT = 'task-prefix' as const;
export type PrpCommitFormat = 'task-prefix' | 'plain';
export function getPrpCommitFormat(): PrpCommitFormat {
  const raw = process.env[PRP_COMMIT_FORMAT];
  if (raw === undefined) return DEFAULT_PRP_COMMIT_FORMAT;
  const v = raw.trim();
  return v === 'plain' ? 'plain' : 'task-prefix';   // any unknown value → default task-prefix
}
```
Update `docs/CONFIGURATION.md` commit-config block to document `PRP_COMMIT_FORMAT`.

### S2 — task-prefix builder + `formatCommitMessage` rework (pure, unit-tested)
```
export interface ItemPosition { phase: number; milestone: number; task: number; subtask?: number; }
export function parseItemPosition(id: string): ItemPosition | null   // P1.M2.T1.S1 → {1,2,1,1}; P1.M2.T1 → {1,2,1}; non-match → null
export function buildTaskPrefix(pos: ItemPosition): string           // {1,2,1,1}→"1.2.1.1"; {1,2,1}→"1.2.1" (trailing elision)
export function formatCommitMessage(message: string, position?: ItemPosition | null): string
  // - position null/absent  → plain:  `${message}\n\nCo-Authored-By: …`  (NO [PRP Auto])
  // - position present, getPrpCommitFormat()==='task-prefix' → `${buildTaskPrefix(position)}: ${message}\n\nCo-Authored-By: …`
  // - position present, format==='plain' → plain message + trailer
  // strip any [PRP Auto] the caller/LLM might have included (defense-in-depth)
```
**Backward-compat:** callers that omit `position` get `plain` (message + trailer) — the
non-backlog sites #3/#4. Remove the old single-arg `[PRP Auto]` return. Update the JSDoc at
`:94-106` (it currently documents the banner as intended).

### S3 — wire `smartCommit` + call sites + update tests
- Extend `SmartCommitOptions` with `position?: ItemPosition | null` (or `itemId?: string`).
  In `smartCommit`, thread `position` into BOTH `formatCommitMessage` wrap sites (`:489`,`:496`,`:500`).
- `task-orchestrator.ts:801,1061`: pass `position: parseItemPosition(subtask.id)`.
- `task-orchestrator.ts:1113` + `bug-hunt-workflow.ts:503`: omit `position` (→ plain, no prefix).
- Update tests asserting `[PRP Auto]`:
  `tests/unit/utils/git-commit.test.ts` (`expect(...).toContain('[PRP Auto]')` etc.),
  `tests/integration/smart-commit.test.ts` (`it('should add [PRP Auto] prefix…')`),
  verify `tests/unit/agents/commit-message-agent.test.ts` still passes (agent must still NOT
  emit the banner — keep that hard rule).

### S4 — stagecoach prompt update
`commit-message-agent.ts:69-77`: change to instruct a plain descriptive imperative summary,
no Conventional-Commit type and no `(P-id)` scope (the task-prefix now encodes position). Keep
"Output ONLY the commit message", the "skip" empty-diff rule, and the "no banner/trailer" rule.

## Test plan (TDD)
- Unit `git-commit.test.ts`: `parseItemPosition` (4-level, 3-level, malformed→null);
  `buildTaskPrefix` (elision); `formatCommitMessage` task-prefix/plain/non-backlog/no-[PRP Auto];
  `getPrpCommitFormat` env variations (mock `process.env`).
- Unit `commit-message-agent.test.ts`: system prompt no longer demands a Conventional-Commit type/scope.
- Integration `smart-commit.test.ts`: subtask commit → `1.x.x.x: …`; non-backlog commit → plain, no prefix.

## Files
- `src/config/constants.ts` (S1), `src/utils/git-commit.ts` (S2/S3), `src/core/task-orchestrator.ts` (S3),
  `src/workflows/bug-hunt-workflow.ts` (S3), `src/agents/commit-message-agent.ts` (S4).
- Docs (Mode A): `docs/CONFIGURATION.md`. (Mode B: README — final task.)