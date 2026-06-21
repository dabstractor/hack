# Groundswell's Own harness-parity.test.ts — Reference & Why We Don't Replicate It

Groundswell ships `src/__tests__/integration/harness-parity.test.ts` (PRD §7.14).
It is the gold-standard pattern for cross-harness parity. This note summarizes
its technique and documents why **P1.M2.T2.S1 does NOT replicate it**, picking
the config/registration-layer strategy instead (see
`mcphandler-and-parity-strategy.md §3`).

## 1. Groundswell's technique (what it does)

- Imports the REAL `PiHarness` and `ClaudeCodeHarness` + `HarnessRegistry`.
- `beforeEach`: `HarnessRegistry._resetForTesting()` + `_resetInitStateForTesting()`,
  then `new PiHarness()` / `new ClaudeCodeHarness()` + `await harness.initialize()`,
  then `HarnessRegistry.getInstance().register(pi/cc)`.
- **Mocks the LLM SDK by overwriting the harness's PRIVATE `sdk` field after
  real `initialize()`** (NOT `vi.mock`):
  - Pi: `harness.sdk = { createAgentSession: vi.fn().mockResolvedValue({ session: fakeSession }) }`
    where `fakeSession` replays scripted pi events (`turn_end`, `tool_execution_start/end`, …).
  - CC: `harness.sdk = { query: vi.fn().mockImplementation(({options}) => asyncGen), createSdkMcpServer, tool }`
    where the async generator yields scripted SDK messages (`assistant` w/ `tool_use`, `result`).
- Calls `await harness.execute(sharedRequest, sharedToolExecutor, hooks)` with a
  shared `vi.fn` `toolExecutor` and `onToolStart`/`onToolEnd` hooks.
- Asserts parity of `AgentResponse` shape/key-set, `metadata.toolCalls`,
  `ToolExecutionRequest`/`Result` shape, and workflow-event TYPE-set.

## 2. The "honest parity matrix" — Groundswell asserts SHAPE, not value equality

A key lesson the parity test must respect: the two harnesses are NOT
value-identical on every field. From Groundswell's own test:

| Dimension                                    | PiHarness                                      | ClaudeCodeHarness                  | Parity assertion                      |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------- | ------------------------------------- |
| `metadata` KEY-SET                           | `{agentId,timestamp,duration,usage,toolCalls}` | SAME keys                          | **equal**                             |
| `metadata.agentId`                           | `'pi'`                                         | `'claude-code'`                    | **NOT equal** (sanctioned divergence) |
| `metadata.usage` / `toolCalls`               | scripted numbers                               | same scripted numbers              | **equal** (scripted)                  |
| `metadata.duration` / `timestamp`            | real                                           | real                               | **type only** (volatile)              |
| `onToolEnd` result `{content,isError}` shape | `{content,isError}`                            | `{content,isError}`                | **shape equal**                       |
| `onToolEnd` `isError` value                  | REAL (from event)                              | **hard-coded `false`** (SDK limit) | **NOT equal**                         |
| `onToolEnd` `duration` value                 | real ≥0                                        | **hard-coded `0`** (SDK limit)     | **NOT equal**                         |
| namespaced tool name `filesystem__read_file` | preserved                                      | preserved                          | **equal**                             |

**Implication for P1.M2.T2.S1:** assert EQUIVALENCE of the tool result that
flows through `MCPHandler` (which IS genuinely harness-independent — same
executor, same `executeTool`), NOT the harness-reported hook metadata (which is
asymmetric). Our stub `toolExecutor` delegates to `MCPHandler.executeTool`, so
the result it returns is byte-identical across "harnesses" by construction. This
is a STRONGER, cleaner equivalence claim than Groundswell's hook-level shape
parity — and it is exactly what PRD §9.3.3/§9.4.4 promises (execution flows
through MCPHandler for both).

## 3. Why we do NOT replicate Groundswell's real-harness approach here

1. **Scope ownership.** Groundswell's own suite already proves ITS harnesses are
   behaviorally interchangeable (AgentResponse shape, hook firing, tool-count).
   Duplicating that in hacky-hack tests Groundswell's internals, not hacky-hack's
   integration. The thing hacky-hack OWNS and must prove is: **its `MCP_TOOLS`
   set registers & executes identically regardless of harness** — which is a
   property of `MCPHandler` + the tool set, not of the harness SDKs.
2. **Fragility.** The technique overwrites a PRIVATE field (`harness.sdk`) and
   scripts vendor-specific event/message shapes (`turn_end` w/ `content[].toolCall`,
   Claude SDK `assistant`/`result` messages). These are Groundswell-internal
   contracts that can change across `groundswell` versions; pinning them in
   hacky-hack creates a maintenance trap.
3. **Dependency availability.** The CC path exercises
   `@anthropic-ai/claude-agent-sdk` (`createSdkMcpServer`, `tool`, `query`).
   Relying on its resolvability + a non-throwing `initialize()` in a unit test is
   exactly the "must NOT require an Anthropic key" risk the contract warns about.
   The config/registration-layer strategy needs none of it.
4. **Contract permission.** The work item explicitly allows "assert at the
   config/registration layer" as an alternative to "mock the harness execute path."
5. **Coverage safety.** No new `src/**/*.ts`; the test lives in `tests/unit/tools/`
   (excluded from the 100% coverage gate). Real-harness instantiation could pull
   uncovered Groundswell code paths into the v8 measurement window (Groundswell is
   outside `src/**`, so actually safe — but the lighter approach removes all doubt).

## 4. Reusable fixture facts (for the PRP author)

From Groundswell's parity test, the canonical shapes the stub should target:

- `ToolExecutionRequest = { name: 'filesystem__read_file', input: { path: '/x' } }`
  (namespaced name preserved through both harnesses).
- `ToolExecutionResult = { content: <string>, isError: false }`.
- `sharedToolExecutor = vi.fn(async (req) => ({ content: 'result-for-'+req.name, isError:false }))`
  — the exact stub pattern Groundswell itself uses. P1.M2.T2.S1's stub instead
  delegates to `MCPHandler.executeTool` (stronger: proves the MCPHandler path).
