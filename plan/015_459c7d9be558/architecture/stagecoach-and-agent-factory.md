# Research: stagecoach-ai npm Package & agent-factory.ts Tool Registration

> Research for Delta PRD §9.10 (Commit Generation & Agent Tool Safety).
> Covers: (1) external `stagecoach-ai` npm package, (2) the in-repo
> `src/agents/agent-factory.ts` tool-registration model.

---

## PART 1 — External Research: `stagecoach-ai` npm Package

### 1.1 Package existence & identity

The package **exists** and is public on npm:

| Field | Value |
|---|---|
| Name | `stagecoach-ai` |
| Latest version | `0.1.16` (published 2026-08-12) |
| License | MIT |
| Registry | https://registry.npmjs.org/stagecoach-ai |
| Repo | https://github.com/dabstractor/stagecoach |
| Maintainer | `trmnl_cmdr` (dmanke@gmail.com) |
| Bin | `stagecoach` → `./bin/stagecoach.js` |
| Tarball size | 7.3 KB (19.5 KB unpacked) |
| Runtime deps | `tar@^7.5.22`, `extract-zip@^2.0.1` |
| Node engines | `>=18` |

**What it is:** A thin npm wrapper that downloads the **stagecoach** native Go binary
at install time (via `postinstall`) and execs it on every `stagecoach` invocation.
Stagecoach is a **snapshot-based AI commit-message generator that shells out to
YOUR local CLI agent** (pi, Claude Code, opencode, Codex, Cursor, agy) rather than
making its own HTTP API call. It spends your existing coding-plan quota instead of
per-token API billing. It owns the commit itself via git plumbing (`write-tree` +
`commit-tree` + `update-ref`): atomic, snapshot-frozen, byte-for-byte unchanged on
failure.

### 1.2 Postinstall native binary download

**Yes**, the package downloads a per-platform native binary at `postinstall`.

**Mechanism** (`install.cjs`):
1. npm runs `node install.cjs` as `postinstall`.
2. The script fetches `checksums.txt` for the package version from GitHub releases
   (`https://github.com/dabstractor/stagecoach/releases/download/v<ver>/...`),
   following GitHub's 302 redirects explicitly (Node's `http.get` does not
   auto-follow).
3. Downloads the matching goreleaser archive
   (`stagecoach_<version>_<goos>_<goarch>.tar.gz` for unix, `.zip` for windows).
4. SHA256-verifies the archive **constant-time** against the checksums line;
   **aborts before writing** on mismatch (a tampered/truncated archive never lingers).
5. Extracts the single `stagecoach`/`stagecoach.exe` binary into the versioned cache
   path: `~/.stagecoach/versions/<version>/<goos>-<goarch>/stagecoach`.

**Supported platforms** (goreleaser matrix): `linux` / `darwin` / `windows` ×
`amd64` / `arm64`.

**`--ignore-scripts` guard:** if postinstall was blocked
(`npm install --ignore-scripts`, corporate mirror), the `bin/stagecoach.js` shim
prints a clear message pointing at the install URL and **exits 1** — never a silent
no-op.

### 1.3 CLI flags (relevant to §9.10.1)

Full CLI reference at `docs/cli.md` in the repo. Key flags for message-only delegation:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | bool | `false` | Run the **full** snapshot→generate→parse→duplicate-check pipeline (same as a real commit, including write-tree snapshot and retry) and **print the message to stdout; do NOT commit**. On generation failure, exits 1 with a short stderr message (not the full recovery recipe). |
| `--single` | bool | `false` | Bypass multi-commit decomposition; force the **single-commit** behavior. Alias: `--no-decompose`. |
| `--format <mode>` | string | `auto` | Message format: `auto` (style learning) \| `conventional` \| `gitmoji` \| `plain`; append `+body` to force subject+body. Unknown = hard error (exit 1). Env: `STAGECOACH_FORMAT`. |
| `--provider <name>` | string | `""` (auto-detect) | Provider/agent to shell out to. Env: `STAGECOACH_PROVIDER`. |
| `--model <name>` | string | `""` (manifest default) | Model override. Env: `STAGECOACH_MODEL`. |
| `--reasoning <level>` | string | `""` (off) | `off\|low\|medium\|high`. Provider-dependent. Env: `STAGECOACH_REASONING`. |
| `--timeout <dur>` | string | `"120s"` | Generation timeout. Env: `STAGECOACH_TIMEOUT`. |
| `--exclude <glob>` | string | — | Exclude matching files from the agent payload (not from the commit). Repeatable. |
| `--verbose` / `-v` | bool | `false` | Print resolved command, raw output, retries. |
| `--all` / `-a` | bool | `false` | Run `git add -A` before snapshotting. |

**The PRD's `stagecoach --dry-run --single` invocation** maps cleanly:
- `--dry-run` → emits the message to stdout without committing (the pipeline
  retains commit ownership).
- `--single` → produces exactly one message (no multi-commit decomposition).

**`--format` ↔ `PRP_COMMIT_STYLE` mapping** (§9.10.1):
```
PRP_COMMIT_STYLE   →   stagecoach --format
─────────────────────────────────────────
unset              →   (native auto, stagecoach default)
plain              →   --format plain
conventional       →   --format conventional
gitmoji            →   --format gitmoji
```

### 1.4 Binary resolution at runtime

The `bin/stagecoach.js` shim (`spawnSync`-based):

```javascript
const cacheRoot = process.env.STAGECOACH_CACHE_DIR ||
  path.join(os.homedir(), '.stagecoach', 'versions');
const cachedBin = path.join(cacheRoot, pkg.version, `${goos}-${goarch}`, binaryName);

if (!fs.existsSync(cachedBin)) {
  process.stderr.write('stagecoach native binary not installed ...');
  process.exit(1);
}

const result = spawnSync(cachedBin, process.argv.slice(2),
  { stdio: 'inherit', env: process.env });
process.exit(typeof result.status === 'number' ? result.status : 1);
```

**Resolution path:** `~/.stagecoach/versions/<pkg.version>/<goos>-<goarch>/stagecoach`
(overridable via `STAGECOACH_CACHE_DIR`). The shim forwards all argv and inherits
stdio + env. It is a synchronous `spawnSync` call — the child runs to completion.

**IMPORTANT architectural note for §9.10.1:** Stagecoach does its own git operations.
In `--dry-run --single` mode it:
1. Snapshots the current index via `git write-tree` (its own atomic snapshot).
2. Generates a message from that snapshot's diff.
3. Prints the message to stdout.
4. Does NOT commit.

This means **stagecoach reads the repo/index directly** — it does NOT accept a diff
via stdin. The PRD's instruction to "Feed the staged diff via stdin" is a **mismatch**
with stagecoach's actual CLI: stagecoach snapshots the repo itself. The pipeline must
ensure files are **staged in the repo index** before invoking `stagecoach --dry-run
--single`, and stagecoach will read that staged state. The message comes back via
**stdout** (captured by the pipeline), not stdin. This is a critical implementation
detail for Milestone 1.2.

**Provider forwarding (§9.10.1):** The pipeline forwards `--provider <pi|claude-code>`
and `--model <resolved-model>`. Stagecoach supports `pi` as a provider natively
(it auto-detects installed agents in order: pi, opencode, cursor, agy, codex, claude).

---

## PART 2 — Codebase Research: `agent-factory.ts` Tool Registration

### 2.1 MCP tool registration model

All MCP tools are registered as **in-process Groundswell `MCPHandler` subclasses**.
Each subclass declares its tools (schemas) and registers executor callbacks.

**Singleton instances** (module-level, shared across all agents):
```typescript
const BASH_MCP = new BashMCP();         // src/tools/bash-mcp.ts
const FILESYSTEM_MCP = new FilesystemMCP(); // src/tools/filesystem-mcp.ts
const GIT_MCP = new GitMCP();            // src/tools/git-mcp.ts

// THE SINGLE uniform tool array — ALL agents receive this identical set
const MCP_TOOLS: MCPServer[] = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP];
```

**Every agent factory** spreads the same `MCP_TOOLS` into the `mcps` config field:
```typescript
const config = { ...baseConfig, system: PROMPT, mcps: MCP_TOOLS };
return createAgent(config);
```

There is **NO per-persona tool differentiation** currently — all five personas get
all three MCP servers with all tools.

### 2.2 Registered tool names (exact)

| MCP Server | Tool Name | Purpose |
|---|---|---|
| `bash` | `execute_bash` | Execute shell commands (spawn with `shell: true`, timeout, SIGTERM→SIGKILL) |
| `filesystem` | `file_read` | Read file contents |
| `filesystem` | `file_write` | Write/create/overwrite files |
| `filesystem` | `glob_files` | Glob-based file search |
| `filesystem` | `grep_search` | Grep file contents |
| `git` | `git_status` | Repository status (branch, staged, modified, untracked) |
| `git` | `git_diff` | Show diff (staged or unstaged) |
| `git` | `git_add` | Stage files (`--` separator, supports `.` for all) |
| `git` | `git_commit` | Create a commit (`simple-git git.commit()`), `--allow-empty` option |

### 2.3 Personas (`AgentPersona` type)

```typescript
export type AgentPersona = 'architect' | 'researcher' | 'coder' | 'qa' | 'cleanup';
```

| Persona | Factory Function | Model Role | Tier | System Prompt |
|---|---|---|---|---|
| `architect` | `createArchitectAgent()` | `reasoning` | balanced | `TASK_BREAKDOWN_PROMPT` |
| `researcher` | `createResearcherAgent()` | `research` | balanced | `PRP_BLUEPRINT_PROMPT` |
| `coder` | `createCoderAgent()` | `implementation` | fast | `PRP_BUILDER_PROMPT` |
| `qa` | `createQAAgent(reasoningLevel)` | `reasoning` | balanced | `BUG_HUNT_PROMPT` |
| `cleanup` | `createCleanupAgent()` | `implementation` | fast | `CLEANUP_PROMPT` |

**Stateless personas** (single-shot, no session): `coder`, `qa`, `cleanup`
(`STATELESS_PERSONAS` set).

### 2.4 `createBaseConfig` internals

```typescript
export function createBaseConfig(
  persona: AgentPersona,
  role: ModelRole = 'research',
  thinking: ThinkingLevel  // REQUIRED — no default
): AgentConfig
```

Returns an `AgentConfig` object with:
- `name`: PascalCase `<Persona>Agent`
- `system`: placeholder `You are a <persona> agent.` (overridden by each factory)
- `model`: resolved via `getModel(tier)` where tier comes from `ROLE_CONFIG[role]`
  (`research`/`reasoning` → balanced, `implementation` → fast)
- `thinking`: passed-through `ThinkingLevel`
- `stateless`: `STATELESS_PERSONAS.has(persona)`
- `harness`: lazy-resolved via `resolvedHarness()` (deferred `configureEnvironment()` +
  `configureHarness()`, per PRD §9.6.2 REQ-L2)
- `enableCache`: `true`
- `enableReflection`: `true`
- `maxTokens`: from `PERSONA_TOKEN_LIMITS[persona]`
- `env`: `{ ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL }`

**NOTE:** `createBaseConfig` does NOT set `mcps`. Each factory adds `mcps: MCP_TOOLS`
in its config spread.

### 2.5 The "Commit agent" — NOT a persona

There is **no `commit` persona** in `AgentPersona` or a `createCommitAgent` factory
in `agent-factory.ts`.

Commit-message generation is currently handled by a **separate** in-process LLM agent:
`createCommitMessageAgent()` in `src/agents/commit-message-agent.ts`. This agent:
- Reuses `createBaseConfig('researcher', 'research', 'off')` as its base.
- Carries **NO MCP tools** (`mcps` field is absent — the agent reads the diff from
  the prompt text).
- Is called by `generateCommitMessage()` in `src/utils/git-commit.ts`, which feeds
  the staged diff via the prompt user-turn.
- The pipeline (via `smartCommit`) owns the actual `gitCommit` call — the agent only
  generates the message text.

For §9.10.1, this in-process agent is being **replaced** by the `stagecoach` binary.
For §9.10.3, there is no agent-level tool to scope for "Commit" — the `git_commit`
tool is invoked directly by `smartCommit` in `git-commit.ts`, not through an agent.

### 2.6 GitMCP class registration pattern (`src/tools/git-mcp.ts`)

```typescript
export class GitMCP extends MCPHandler {
  public readonly name = 'git';
  public readonly transport = 'inprocess' as const;
  public readonly tools = [gitStatusTool, gitDiffTool, gitAddTool, gitCommitTool];

  constructor() {
    super();
    this.registerServer({ name: this.name, transport: this.transport, tools: this.tools });
    this.registerToolExecutor('git', 'git_status', async (input) => gitStatus(input));
    this.registerToolExecutor('git', 'git_diff', async (input) => gitDiff(input));
    this.registerToolExecutor('git', 'git_add', async (input) => gitAdd(input));
    this.registerToolExecutor('git', 'git_commit', async (input) => gitCommit(input));
  }
}
```

The `gitCommit` function uses `simple-git`'s `git.commit(message, [], options)`. It
does **not** set `user.name`/`user.email` or `GIT_AUTHOR_*`/`GIT_COMMITTER_*` — it
delegates to simple-git's default behavior (which uses the repo's git config).

**For Milestone 1.1 (snapshot-based plumbing commit):** The current `gitCommit`
uses high-level `git.commit()`. The PRD requires rewriting to use git plumbing
(`write-tree` → `commit-tree` → CAS `update-ref`). This would require either:
- New git-mcp functions (`gitWriteTree`, `gitCommitTree`, `gitUpdateRef`), OR
- New plumbing helpers directly in `git-commit.ts` that spawn git subprocesses.

The current `git-mcp.ts` uses the `simple-git` library exclusively (no raw
`child_process` git calls). The plumbing commit would likely need `simpleGit.raw()`
calls or direct `child_process.execFileSync`.

### 2.7 BashMCP class registration pattern (`src/tools/bash-mcp.ts`)

```typescript
export class BashMCP extends MCPHandler {
  public readonly name = 'bash';
  public readonly transport = 'inprocess' as const;
  public readonly tools = [bashTool]; // { name: 'execute_bash', ... }

  constructor() {
    super();
    this.registerServer({ name: this.name, transport: this.transport, tools: this.tools });
    this.registerToolExecutor('bash', 'execute_bash', async (input) => executeBashCommand(input));
  }
}
```

**No denylist currently exists.** The `executeBashCommand` function runs any command
via `spawn(command, { shell: true })` with only a timeout watchdog (SIGTERM→SIGKILL).
There is no command-string inspection or refusal before exec. The PRD §9.10.3
requires adding a pre-exec denylist (fail-closed on remote/default-branch-mutating
commands) in `executeBashCommand` before the `spawn` call.

### 2.8 Implications for §9.10.3 Per-Role Tool Matrix

Current state: **all personas → `MCP_TOOLS` = [bash, filesystem, git]** (uniform).

PRD §9.10.3 requires:

| Role | bash | git_status | git_diff | git_add | git_commit | filesystem |
|---|---|---|---|---|---|---|
| Research / Planner / Coder | ✗ | ✓ (read-only) | ✓ (read-only) | ✗ | ✗ | ✓ |
| Commit | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Validation (QA) | ✓ (denylisted) | ✓ | ✓ | ✓ | ✓ | ✓ |

**Implementation approach:** Replace the single `MCP_TOOLS` constant with
per-persona tool arrays. Each agent factory would construct its own `mcps` array
from filtered subsets of the three MCP servers. This requires either:
- Multiple MCP server instances per tool-type with different tool sets, OR
- A single MCP server class that exposes a configurable subset of its tools (e.g.,
  `new GitMCP({ tools: ['git_status', 'git_diff'] })`), OR
- Wrapper/filter MCP servers that restrict which tools are visible.

The simplest approach following existing patterns: create filtered MCPServer arrays
per persona by constructing GitMCP/BashMCP/FilesystemMCP with restricted tool lists,
or by creating lightweight wrapper MCPServers that subset the `tools` array and
re-register only the allowed tool executors.

### 2.9 Who calls `smartCommit` with `generateMessage: true`

From `src/core/task-orchestrator.ts`:
- Line 810-814: HEAD-disagreement recovery commit
- Line 1073-1077: pre-cleanup survival commit
- Line 1128-1131: post-cleanup commit

From `src/workflows/bug-hunt-workflow.ts`:
- Line 531: bug-hunt result persistence commit

All these callers pass `{ generateMessage: true }`, which triggers the
`generateCommitMessage` → `createCommitMessageAgent` path. When Milestone 1.2
replaces the in-process agent with the stagecoach binary, all these callers continue
to work unchanged — the delegation is internal to `generateCommitMessage`.

---

## Summary of Key Findings

1. **`stagecoach-ai` exists and works** — v0.1.16, downloads a Go native binary at
   postinstall, supports `--dry-run --single --format --provider --model`.
2. **Stagecoach reads the repo index directly** — it does NOT accept a diff via stdin.
   The pipeline must stage files in the repo before invoking stagecoach, and capture
   the generated message from stdout. (PRD's "feed diff via stdin" is a design-doc
   imprecision — stagecoach snapshots the index itself.)
3. **All agents currently share the same uniform tool set** — no per-role scoping
   exists. The `MCP_TOOLS` constant is a single `[BashMCP, FilesystemMCP, GitMCP]`
   array passed to every persona.
4. **There is no "Commit" persona** — commit messages are generated by a separate
   in-process agent (`commit-message-agent.ts`) that carries no tools. The actual
   `git_commit` is called directly by `smartCommit` in `git-commit.ts`.
5. **No bash denylist exists** — `executeBashCommand` runs any command via
   `shell: true` spawn with only a timeout guard.
6. **`gitCommit` uses simple-git high-level API** — the plumbing commit
   (`write-tree`/`commit-tree`/`update-ref`) is NOT present and would need new
   helpers using `simpleGit.raw()` or direct `child_process` calls.