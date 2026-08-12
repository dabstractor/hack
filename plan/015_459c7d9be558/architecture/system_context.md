# System Context — Delta 015: Commit Generation & Agent Tool Safety

> Consolidated architectural findings grounding the task breakdown.
> References: `commit-tests-survey.md`, `format-nudge-analysis.md`,
> `stagecoach-and-agent-factory.md` (sibling research artifacts).

---

## 1. Project Identity

- **Name:** `hacky-hack` — Autonomous PRP Development Pipeline
- **Runtime:** Node.js 20+ / TypeScript 5.2+ (ESM, `"type": "module"`)
- **Framework:** Groundswell (local library, `createAgent`/`MCPHandler`/`createPrompt`)
- **Test runner:** Vitest (`npm test` / `npx vitest run`)
- **Build:** `tsc -p tsconfig.build.json`
- **Git lib:** `simple-git` (used exclusively in `src/tools/git-mcp.ts`)

## 2. Current Commit Subsystem Architecture

### 2.1 The commit path (callers → smartCommit → agent → git)

```
task-orchestrator.ts (3 call sites) + bug-hunt-workflow.ts (1 call site)
  └─ all pass { generateMessage: true }
     └─ smartCommit(sessionPath, message, options)  [src/utils/git-commit.ts]
         ├─ gitStatus(repoRoot)         [git-mcp.ts — simple-git]
         ├─ filterProtectedFiles()
         ├─ gitAdd(repoRoot, filtered)  [simple-git git.add(['--', ...files])]
         ├─ restore_critical_files()    [gitListStagedDeletions → restore/unstage]
         ├─ gitDiff({staged:true})      [simple-git git.diff('--cached')]
         ├─ generateCommitMessage(diff) ─→ createCommitMessageAgent (IN-PROCESS LLM)
         │   └─ retry() wrapper with COMMIT_RETRY_MAX (5) / backoff
         │   └─ fallback: buildFallbackCommitMessage → placeholder
         ├─ formatCommitMessage(generated, position)  [layers task-prefix, NO trailer]
         └─ gitCommit(repoRoot, message) [simple-git git.commit()]
```

### 2.2 What changes for this delta

| Component | Current | Target (delta) |
|-----------|---------|----------------|
| `gitCommit` in git-mcp.ts | `simple-git` `git.commit()` | **Removed from agent path** — replaced by plumbing: `write-tree` → `commit-tree` → CAS `update-ref` |
| `generateCommitMessage` | In-process LLM agent (`commit-message-agent.ts`) | **`stagecoach --dry-run --single`** binary exec (argv vector) |
| `commit-message-agent.ts` | Exists (385 lines, 4 style modes) | **Deleted** — stagecoach's own discipline replaces it |
| Staging (`gitAdd`) | `git.add(['--', ...everyFile])` — ARG_MAX risk | Pathspec (`git add -A`) default; chunked for filtered sets |
| `formatCommitMessage` | Already identity-transparent (no trailer) | **Guard test added** (self-source-scan); behavioral tests inverted |
| `agent-factory.ts` tools | Uniform `MCP_TOOLS = [bash, fs, git]` for ALL agents | **Per-role matrix** — most agents lose bash; git scoped read-only |
| `bash-mcp.ts` | Zero filtering — `spawn(cmd, {shell:true})` | **Denylist** — refuse remote/default-branch mutation before exec |

## 3. Key Architectural Patterns

### 3.1 MCP tool registration (agent-factory.ts)

- Three singleton `MCPHandler` subclasses: `BashMCP`, `FilesystemMCP`, `GitMCP`
- Each declares `tools: Tool[]` (JSON-schema) + `registerToolExecutor()` callbacks
- Combined into one `MCP_TOOLS: MCPServer[]` array → spread into every agent's `mcps` config
- **Per-role scoping** requires replacing this single array with per-persona filtered subsets

### 3.2 Git operations (git-mcp.ts)

- ALL git ops go through `simpleGit` (the `simple-git` library)
- `simpleGit.raw()` is available for raw plumbing commands — it uses `child_process.execFile` internally (NOT shell), so it satisfies §5.1's "never `sh -c`" requirement
- New plumbing functions should use `simpleGit.raw(['write-tree'])` etc., OR direct `child_process.execFile` calls for maximum control

### 3.3 Config constants pattern (config/constants.ts)

- Named constant (e.g. `COMMIT_RETRY_MAX`) + `DEFAULT_*` value + `get*()` reader function
- `FORMAT_NUDGE_MAX` follows this pattern but is **intentionally NOT exposed as env/.hack** — it's an internal constant with a fixed default

## 4. Implementation State vs. PRD (verified)

### Already done (do NOT rebuild)
- `formatCommitMessage` — no Co-Authored-By trailer (behavioral fix complete)
- `smart-commit.test.ts` — already asserts trailer absence
- Format-nudge recovery — ~90% across all three variants (see `format-nudge-analysis.md`)

### Missing / to build
- Git plumbing functions (`write-tree`/`commit-tree`/`update-ref CAS`) — entirely absent
- ARG_MAX-safe staging refactor
- `.gitignore` scaffolding rule in breakdown prompt
- `stagecoach-ai` dependency + binary delegation
- Delete `commit-message-agent.ts` + rewire tests
- Self-source-scan guard test
- Behavioral test inversion (stray `>` blocker bug in `git-commit.test.ts`)
- Bash denylist in `bash-mcp.ts`
- Per-role tool matrix in `agent-factory.ts`
- Universal remote-mutation prohibition in prompts
- `FORMAT_NUDGE_MAX` constant + consistent wiring

## 5. Critical Implementation Notes

### 5.1 Stagecoach reads the repo index directly (NOT stdin)
The PRD's "feed the staged diff via stdin" is a design-doc imprecision. The
`stagecoach` binary snapshots the repo index itself via its own `git write-tree`.
The pipeline MUST ensure files are **staged in the repo index** before invoking
`stagecoach --dry-run --single`; stagecoach reads that staged state and emits the
message via **stdout**. Provider/model/style are forwarded via argv flags.

### 5.2 The pipeline retains ownership of the commit
Even though stagecoach does its own `write-tree` internally (in `--dry-run` mode),
the pipeline's own plumbing commit is the one that actually creates the commit.
Stagecoach only generates the message text. The flow is:
1. Pipeline stages files (ARG_MAX-safe)
2. Pipeline runs `restore_critical_files`
3. Pipeline invokes `stagecoach --dry-run --single` → message via stdout
4. Pipeline runs its own `write-tree` → `commit-tree` → CAS `update-ref`

### 5.3 The stray `>` blocker bug
`tests/unit/utils/git-commit.test.ts` has trailing `>` characters in nearly every
`toBe` expected value (artifact of a partial trailer-inversion). These tests are
**currently red**. Must be fixed as part of the behavioral test inversion.

### 5.4 No "Commit" agent persona exists
Commit-message generation was handled by a standalone in-process agent
(`commit-message-agent.ts`), NOT by a Groundswell persona. The `git_commit` tool
is invoked directly by `smartCommit` in `git-commit.ts`. The §9.10.3 "Commit agent"
role in the tool matrix refers to the code path that commits, not an agent persona.
For per-role tool scoping, the commit path (`smartCommit`) is internal pipeline
code — it's not agent-scoped.

### 5.5 Bash tool uses `shell: true`
`executeBashCommand` in `bash-mcp.ts` spawns with `shell: true` (`/bin/sh -c`).
The denylist must inspect the raw command string BEFORE the spawn call and refuse
matching commands. The `shell: true` usage is intentional (needed for pipes,
loops, `&&`) and stays — the denylist is a pre-exec gate, not a sandbox.