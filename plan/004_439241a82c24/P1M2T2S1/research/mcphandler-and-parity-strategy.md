# MCPHandler API Surface & Parity-Test Strategy

Authoritative reference for how hacky-hack's `MCP_TOOLS` (BashMCP /
FilesystemMCP / GitMCP) register and execute through Groundswell's
`MCPHandler`, and the **strategy** P1.M2.T2.S1 uses to prove tool
discovery/execution is harness-independent (PRD §9.3.3 / §9.4.4).

Source of truth: `node_modules/groundswell/dist/` (linked v0.0.4) +
`~/projects/groundswell/src/core/mcp-handler.ts`.

## 1. MCPHandler — the shared execution substrate (read directly from source)

`MCPHandler` (`groundswell/core/mcp-handler.ts`, re-exported from the package
root) is the object tools register into AND execute through. Key public surface:

```ts
export type ToolExecutor = (input: unknown) => Promise<unknown>; // MCPHandler-level

class MCPHandler {
  registerServer(server: MCPServer): void; // namespacing happens HERE
  registerToolExecutor(serverName, toolName, executor: ToolExecutor): void;
  getTools(): Tool[]; // namespaced names
  executeTool(toolName, input): Promise<ToolResult>; // namespaced dispatch
  hasTool(toolName): boolean;
  getServerNames(): string[];
  toAgentSDKServer(): McpServerConfig | null; // claude-code consumer path
}
```

**CRITICAL namespacing rule** (from `registerServer`):

```ts
const fullName = `${server.name}__${tool.name}`; // e.g. 'filesystem__file_read'
```

Duplicate server name → `throw new Error("MCP server '<name>' is already registered")`.

**CRITICAL executeTool behavior** (harness-agnostic by construction):

- Looks up `registeredTools.get(toolName)`. If missing → returns
  `{ type:'tool_result', tool_use_id:'', content:'Tool <name> not found',
is_error:true }` (no throw).
- On success → `await executor(input)`, returns
  `{ type:'tool_result', tool_use_id:'', content: <stringified result> }`.
- On executor throw → returns `{ ..., content:'Tool execution failed: <msg>',
is_error:true }`.
- **`executeTool` takes NO harness parameter.** It is a pure function of
  `(toolName, input)`. This is the architectural fact the parity test locks.

## 2. The hacky-hack tools ARE MCPHandlers (self-registering singletons)

`BashMCP` / `FilesystemMCP` / `GitMCP` each `extends MCPHandler` and, in their
constructor, call `this.registerServer({...})` + `this.registerToolExecutor(...)`
on THEMSELVES. So each instance is simultaneously an `MCPServer` (exposes
`name`/`transport`/`tools`) AND an `MCPHandler` (exposes `getTools`/`executeTool`).

`MCP_TOOLS` (`src/agents/agent-factory.ts`) = `[BASH_MCP, FILESYSTEM_MCP,
GIT_MCP]` — three module-load singletons. Passed to every persona config via
`mcps: MCP_TOOLS`.

### 2.1 Canonical namespaced tool names (9 tools / 3 servers) — VERIFIED from src/tools/\*.ts

| server.name  | tool.name(s)                                           | namespaced                                                                                             |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `bash`       | `execute_bash`                                         | `bash__execute_bash`                                                                                   |
| `filesystem` | `file_read`, `file_write`, `glob_files`, `grep_search` | `filesystem__file_read`, `filesystem__file_write`, `filesystem__glob_files`, `filesystem__grep_search` |
| `git`        | `git_status`, `git_diff`, `git_add`, `git_commit`      | `git__git_status`, `git__git_diff`, `git__git_add`, `git__git_commit`                                  |

Discovery algorithm (used by the test, mirroring `registerServer`):
`names = mcps.flatMap(s => (s.tools ?? []).map(t => `${s.name}__${t.name}`))`.

## 3. The two contract-permitted strategies & which one P1.M2.T2.S1 picks

Work-item contract (point 3 + MOCKING) offers an explicit **OR**:

> "mock the harness execute path **OR** assert at the config/registration layer"
> "The test must NOT actually require an Anthropic key for the `claude-code` branch."

| Strategy                                                        | What it does                                                                                                                                                                                                                                                                                                                 | Cost / risk                                                                                                                                                                                                          | Picked? |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **(A) Mock harness execute path**                               | Instantiate real `PiHarness`/`ClaudeCodeHarness`, `initialize()`, overwrite private `sdk` field, wire scripted tool-use events, run `execute(req, toolExecutor)`, assert toolExecutor called w/ equivalent requests (this is Groundswell's OWN `harness-parity.test.ts` pattern — see groundswell-parity-test-reference.md). | Heavyweight; needs `@anthropic-ai/claude-agent-sdk` resolvable + real `initialize()`; couples test to Groundswell private fields (`harness.sdk`) that may move; duplicates Groundswell's own coverage of ITS parity. | **No**  |
| **(B) Config/registration layer + direct MCPHandler execution** | Prove (i) both harness agent-configs share the same `MCP_TOOLS` ref & differ only in `harness`; (ii) `MCP_TOOLS` → identical namespaced names; (iii) a stub `toolExecutor` delegating to `MCPHandler.executeTool` returns an equivalent result for both, since `executeTool` never consults the harness.                     | Light, stable, 100%-coverage-safe, no SDK/LLM/network, directly tests the hacky-hack integration boundary (the thing hacky-hack OWNS — its `MCP_TOOLS`). Explicitly permitted by the contract's OR.                  | **YES** |

**Why (B) is the faithful, sufficient proof of the PRD invariant:**
PRD §9.3.3 / §9.4.3 / §9.4.4 state tool execution **flows through `MCPHandler`
for both harnesses**; the harness only REPORTS tool calls back. `MCPHandler` is
constructed & operated identically regardless of harness; `executeTool` takes no
harness argument. Therefore demonstrating that (a) the tool SET is shared and
identically-discovered across harness configs, and (b) `executeTool` is a pure
`(name, input)` function whose result a stub toolExecutor hands back unchanged,
IS a proof of harness-independence — without the fragility of mocking real
harness internals.

**Documented deviation (mirrors P1.M2.T1.S2's style):** the contract mentions
"a stub returning a canned AgentResponse". `AgentResponse` is the high-level
agent-turn wrapper; the precise tool-level shape is `ToolExecutionResult`
(`{content, isError}`, see §4). The stub returns a canned `ToolExecutionResult`
(which is what the harness-level `toolExecutor` callback actually yields). This
is the more precise realization of the contract; note it in the commit message.

## 4. Exact Groundswell type shapes (VERIFIED from dist \*.d.ts)

```ts
// node_modules/groundswell/dist/types/sdk-primitives.d.ts
interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown;
  is_error?: boolean;
}
interface MCPServer {
  name: string;
  version?: string;
  transport: 'stdio' | 'inprocess';
  command?: string;
  args?: string[];
  tools?: Tool[];
  env?: Record<string, string>;
}

// node_modules/groundswell/dist/types/harnesses.d.ts  (lines 111-141)
interface ToolExecutionRequest {
  name: string;
  input: unknown;
} // harness-level req
interface ToolExecutionResult {
  content: string | unknown;
  isError: boolean;
} // harness-level result

// node_modules/groundswell/dist/types/providers.d.ts (line 197) — the harness toolExecutor cb
type ToolExecutor = (
  request: ToolExecutionRequest
) => Promise<ToolExecutionResult>;
```

NOTE: there are TWO different `ToolExecutor` types in Groundswell:

- `MCPHandler`'s `ToolExecutor = (input:unknown)=>Promise<unknown>` (registered
  per-tool via `registerToolExecutor`).
- The harness-level `ToolExecutor = (req:ToolExecutionRequest)=>Promise<ToolExecutionResult>`
  passed as the 2nd arg to `harness.execute()`.
  The parity test stubs the HARNESS-level one (delegating to `MCPHandler.executeTool`,
  which returns `ToolResult`, then maps to `ToolExecutionResult`).

## 5. What `createBaseConfig` returns (relevant to the config-layer assertion)

`createBaseConfig(persona)` (`src/agents/agent-factory.ts`) returns:
`{ name, system, model, harness, enableCache, enableReflection, maxTokens, env }`
— **NO `mcps`**. The persona factories add `mcps: MCP_TOOLS` via spread:
`{ ...baseConfig, system: PROMPT, mcps: MCP_TOOLS }`. The parity test mirrors
this exact spread to build the two harness configs:
`{ ...createBaseConfig('researcher'), mcps: MCP_TOOLS, harness: 'pi'|'claude-code' }`.

## 6. Boundaries — what P1.M2.T2.S1 does NOT touch (disjoint from siblings)

- **NOT** the harness↔provider compatibility rejection (`HarnessProviderMismatchError`
  thrown by `configureHarness()` for claude-code+zai) — that is **P1.M2.T1.S2**.
  The parity test constructs a `harness:'claude-code'` CONFIG OBJECT without
  invoking `configureHarness()`, so no throw, no overlap. (Documented inline.)
- **NOT** the provider-endpoint guard — that is **P1.M2.T1.S1**.
- **NOT** cache-key isolation — that is **P1.M2.T2.S2** (the parallel sibling).
- **NOT** docs — that is **P1.M2.T3**.
- Does NOT create any new `src/**/*.ts` → no new coverage obligation (100% safe).

## 7. Existing tests that touch MCP_TOOLS / MCPHandler (confirmed NON-overlapping)

- `tests/unit/agents/agent-factory.test.ts` — asserts `MCP_TOOLS` is 3
  MCPServer-compliant objects with distinct names; asserts agents create without
  registration conflict. Does NOT assert harness PARITY or execution equivalence.
- `tests/integration/groundswell/mcp.test.ts` — asserts `registerServer`/
  `getTools`/`hasTool`/`registerToolExecutor`/`agent.getMcpHandler()` for a
  SINGLE mock agent. Does NOT cross pi vs claude-code.
- `tests/integration/mcp-tools.test.ts` — asserts each agent type has the 3 MCP
  servers registered & accessible. Does NOT assert cross-harness parity.
- `tests/unit/tools/{bash,filesystem,git}-mcp.test.ts` — per-tool executor
  unit tests (mocked child_process/fs/simple-git). Disjoint.

**Gap P1.M2.T2.S1 closes:** none of the above proves tool discovery/execution is
harness-independent. This is the explicit PRD §9.4.3 "Feature parity" requirement
encoded as a test.
