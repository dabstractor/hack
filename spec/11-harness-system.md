### 9.4 Agent Harness System (Runtime Selection)

This project adopts Groundswell's pluggable **harness** model (Groundswell PRD §7). The **harness** is the agent runtime/SDK that drives prompting, tool execution, and streaming; it is **orthogonal** to the LLM **provider/model**. The two are selected independently. **Primacy:** `pi` is the first-class default; `claude-code` is a second-class, parity-maintained option retained for Anthropic loyalists (see §9.1). Auth for either harness is provider-aware (§9.2.6) and gated by a fail-fast preflight (§9.2.7).

#### 9.4.1 Supported Harnesses

| Harness       | SDK / Package                                       | Default?      | Notes                                                                                                                                                          |
| ------------- | --------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi`          | Pi SDK — `@earendil-works/pi-coding-agent` (pi.dev) | **Yes**       | Vendor-neutral runtime; runs any LLM provider (incl. z.ai). MCP, Skills, and LSP are supplied by Groundswell's `MCPHandler`.                                   |
| `claude-code` | Claude Code SDK — `@anthropic-ai/claude-agent-sdk`  | No (optional) | Anthropic-only models. Incompatible with the z.ai provider (see §9.2.4). Retained as a parity-maintained fallback for users locked into Anthropic's ecosystem. |

**Default selection.** `PRP_AGENT_HARNESS` defaults to `pi` (pi.dev). This is the only harness compatible with the project's default z.ai provider and the §9.2.4 cost safeguard.

#### 9.4.2 Configuration

```ts
import { configureHarnesses } from 'groundswell';

configureHarnesses({
  defaultHarness: 'pi', // vendor-neutral, first-class default (pi.dev)
  defaultModelProvider: 'zai', // LLM host — independent of harness
  harnessDefaults: {
    // 'pi': auth resolved provider-natively (override / env var / ~/.pi/agent/auth.json);
    //       see §9.2.6. Do NOT inject an empty apiKey — forward an override only when non-empty.
    'claude-code': { apiKey: process.env.ANTHROPIC_API_KEY }, // Anthropic-only harness
  },
});
```

- **`PRP_AGENT_HARNESS`** (`pi` | `claude-code`, default `pi`): selects the runtime.
- Harness selection cascades: global default → agent config → prompt overrides.
- Harness-specific options (e.g. `skillsDirs` on `pi`) MAY extend the base `HarnessOptions`.

#### 9.4.3 Critical Rules

- **The harness never appears in the model string.** `pi/zai/glm-5.2` and `cc/anthropic/...` are **invalid**. Always use `provider/model` (e.g. `zai/glm-5.2`).
- **Provider/harness compatibility.** `claude-code` runs `anthropic/*` models only. Requesting the z.ai provider on `claude-code` is a configuration error surfaced at `initialize()`/`execute()`.
- **Feature parity.** All features (MCP tools, skills, hooks, `AgentResponse`, caching, workflow events) MUST work identically across both harnesses. Tool execution flows through `MCPHandler` for both, so `pi`'s lack of built-in MCP/LSP is **not** a capability gap.
- **Cache isolation.** Cache keys incorporate **both** the harness and the provider/model.

#### 9.4.4 Capability Reference

| Capability        | `pi`                                                | `claude-code`                     |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| MCP               | via Groundswell `MCPHandler`                        | built-in **and** via `MCPHandler` |
| Skills            | ✓ native (agentskills.io; loads `~/.claude/skills`) | ✓ native (system prompt)          |
| LSP               | via MCP plugins through `MCPHandler`                | via MCP plugins                   |
| Streaming         | ✓                                                   | ✓                                 |
| Sessions          | ✓                                                   | ✓                                 |
| Extended Thinking | ✓                                                   | ✓                                 |
| LLM providers     | any                                                 | Anthropic only                    |
