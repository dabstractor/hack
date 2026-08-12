# P1.M4.T2.S1 Research — Per-persona MCP tool subsets

Source: direct reads of `src/agents/agent-factory.ts`, `src/tools/{git,bash,filesystem}-mcp.ts`,
`node_modules/groundswell/dist/core/mcp-handler.d.ts` + `types/sdk-primitives.d.ts`, the existing
`tests/unit/agents/agent-factory.test.ts`, and a grep for `MCP_TOOLS` consumers. The
`stagecoach-and-agent-factory.md` architecture doc (§2.1–§2.8) is the primer.

## 1. The contract tool matrix (item description = authoritative)

| Persona | bash | filesystem | git tools |
|---|---|---|---|
| architect | none | full (file_read/write/glob/grep) | git_status, git_diff (read-only) |
| researcher | none | full | git_status, git_diff (read-only) |
| coder | none | full | git_status, git_diff (read-only) |
| cleanup | none | full | git_status, git_diff (read-only) |
| qa | **denylisted** (P1.M4.T1.S1, already landed) | full | **ALL** (git_status, git_diff, git_add, git_commit) |

NOTE: PRD §9.10.3 matrix shows "—" for the Validation row's git column, but the **item-description
contract** resolves the qa/git intersection to FULL git (qa/bug-hunt inspects repo state). Follow the
item description. There is NO "commit" persona — commit is internal `smartCommit` (architecture §2.5).

## 2. Current state (what changes)

`agent-factory.ts:83-85` singletons + `:87 MCP_TOOLS = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP]`. Every
factory spreads `mcps: MCP_TOOLS` (architect/researcher/coder/qa/cleanup — 5 sites). `createBaseConfig`
does NOT set `mcps`; only the factories do. `MCP_TOOLS` is `export`-ed.

## 3. The MCP registration model (how to subset)

Each `GitMCP`/`BashMCP`/`FilesystemMCP` `extends MCPHandler` (groundswell). In its constructor it calls:
- `this.registerServer({ name, transport:'inprocess', tools })` → populates the handler's private
  `registeredTools` (the discoverable tool schemas; `getTools()`/`toPiCustomTools()`/`toAgentSDKServer()`
  iterate THESE).
- `this.registerToolExecutor(serverName, toolName, fn)` → per-tool callback.

Each instance holds its OWN private `servers`/`registeredTools`/`toolExecutors` maps. So a SEPARATE
instance that `registerServer`s only `git_status`+`git_diff` and registers only those 2 executors
exposes EXACTLY those 2 tools — the cleanest subsetting mechanism (no monkey-patching, no unregister).
Server `name` can stay `'git'` (it's the tool namespace; no single persona ever holds two `'git'`
servers, so no collision).

`MCPServer` interface (`sdk-primitives.d.ts:34`): `{ name:string; transport:'stdio'|'inprocess'; tools?:Tool[]; ... }`.

**Decision: add `ReadOnlyGitMCP extends MCPHandler` in `src/tools/git-mcp.ts`** (natural home; reuses
the already-exported `gitStatusTool`, `gitDiffTool`, `gitStatus`, `gitDiff`). name='git',
tools=[gitStatusTool, gitDiffTool], registers 2 executors. ~20 lines, follows the existing class pattern
exactly. The full `GitMCP` (4 tools) stays as-is → qa reuses it.

## 4. buildToolSet + singletons (agent-factory.ts)

- Add `const READ_ONLY_GIT_MCP = new ReadOnlyGitMCP();` singleton.
- Keep `MCP_TOOLS = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP]` (the FULL set) so `buildToolSet('qa')` can
  return IT (preserves object-identity for qa tests) — OR rename intent; simplest: keep MCP_TOOLS and
  have qa return it.
- Add `export function buildToolSet(persona: AgentPersona): MCPServer[]`:
  - qa → MCP_TOOLS (full: filesystem + denylisted bash + full git)
  - architect/researcher/coder/cleanup → a module-level `RESTRICTED_TOOLS = [FILESYSTEM_MCP, READ_ONLY_GIT_MCP]`
    constant (no bash; read-only git). Return the CONSTANT (not a fresh array) so object identity holds
    per persona-group.
- Replace `mcps: MCP_TOOLS` in all 5 factories with `mcps: buildToolSet('<persona>')`.
- `MCP_TOOLS` stays exported (consumed by tests) — document it as the full/qa set.

## 5. CRITICAL — MCP_TOOLS is consumed by 5 test files (all must be checked/updated)

```
tests/unit/agents/agent-factory.test.ts       # primary — asserts MCP_TOOLS length 3, names, identity
tests/unit/agents/cleanup-agent.test.ts:106   # "should carry MCP_TOOLS (cleanup mutates the FS)"
tests/unit/tools/mcp-tool-parity.test.ts      # config.mcps === MCP_TOOLS (researcher), 9 tools, identity
tests/integration/coder-agent-config.test.ts  # imports MCP_TOOLS (line ~190)
tests/integration/qa-agent.test.ts:359        # qa config mcps === MCP_TOOLS (PASSES if qa→MCP_TOOLS)
```

Breakage analysis (assuming buildToolSet('qa')===MCP_TOOLS, others===RESTRICTED_TOOLS):
- **mcp-tool-parity.test.ts** — uses `createBaseConfig('researcher')`; researcher is now RESTRICTED (6
  tools, not 9) and `config.mcps !== MCP_TOOLS`. **BREAKS** → update to a qa persona OR to
  `buildToolSet(...)`.
- **cleanup-agent.test.ts** — asserts cleanup carries MCP_TOOLS. cleanup is now RESTRICTED. **BREAKS**
  → update assertion to `buildToolSet('cleanup')` (filesystem + read-only git).
- **coder-agent-config.test.ts** — coder is now RESTRICTED. Likely **BREAKS** → update.
- **qa-agent.test.ts** — qa config.mcps === MCP_TOOLS. If buildToolSet('qa') returns MCP_TOOLS,
  **PASSES unchanged** (verify).
- **agent-factory.test.ts** — add a `buildToolSet` describe (per-persona matrix); the existing
  `MCP_TOOLS` describe still passes (MCP_TOOLS stays the full set).

The item-description OUTPUT names only agent-factory.test.ts, but the build CANNOT go green without
updating the 3–4 breaking consumers above. Treat them as required in-scope tasks (direct consequence of
the change; not new behavior).

## 6. Other BashMCP construction sites (OUT OF SCOPE — do NOT touch)

`src/agents/prp-executor.ts:272` (`this.#bashMCP = new BashMCP()`) and
`src/workflows/validation-workflow.ts:318` (`new BashMCP()`) construct BashMCP for DIRECT execution
(running validation gates / validate.sh), NOT as an agent-exposed tool. They are unaffected by persona
tool scoping (and already inherit the T1.S1 denylist via executeBashCommand). Leave them.

## 7. §9.10.3 acceptance criteria (the validation bar)

- research/planner/coder/cleanup agent tool set contains NO `execute_bash` and NO `git_*` beyond
  `git_status`/`git_diff`.
- qa agent tool set contains `execute_bash` (denylisted) + full git.
- No agent tool, in any role, can change a remote ref / default branch (bash denylist from T1.S1 +
  no agent has `git push`/`git remote` tools — structured git tools can't reach a remote).

These map directly to buildToolSet tests: assert the discoverable tool NAMES per persona
(enumerate via `mcp.tools.map(t=>t.name)` or `getTools()`).