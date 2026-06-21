# PRP — P1.M2.T2.S1: Tool-execution parity test via MCPHandler

---

## Goal

**Feature Goal**: Prove, with a green deterministic test suite, that tool
**discovery** and **execution** are **harness-independent** — i.e. the same
hacky-hack `MCP_TOOLS` set (`BashMCP`/`FilesystemMCP`/`GitMCP` singletons in
`src/agents/agent-factory.ts`) registers and executes identically whether the
agent config nominally targets the `pi` or the `claude-code` harness. Encode
PRD §9.4.3 ("Feature parity … Tool execution flows through `MCPHandler` for
both") and PRD §9.3.3 / §9.4.4 (MCP works under both harnesses via
`MCPHandler`) as executable assertions. **No LLM, no network, no Anthropic key**
for the `claude-code` branch — the contract explicitly permits the
config/registration-layer strategy (see Why + Known Gotchas).

**Deliverable**:

1. **`tests/unit/tools/mcp-tool-parity.test.ts`** — **CREATE**: a characterization
   test that, with the LLM provider uninvolved, asserts across the `pi` and
   `claude-code` harness **configs** (the only harness-aware surface): **(a)**
   discovery parity — the same `MCP_TOOLS` set yields the identical namespaced
   tool-name set; **(b)** execution parity — a stub `toolExecutor` (harness-level
   `(req)=>Promise<ToolExecutionResult>`) delegating to `MCPHandler.executeTool`
   returns an **equivalent** result for both harnesses, because `executeTool` is
   a pure `(name, input)` function that never consults the harness. No new
   `src/**/*.ts` is created → the 100% coverage gate is unaffected.

**Success Definition** (the contract from the work item):

- **(a) Discovery parity**: building the agent config under both `pi` and
  `claude-code` harnesses references the **same** `MCP_TOOLS` array (object
  identity) and produces the **identical** 9-element namespaced tool-name set
  (`bash__execute_bash`, `filesystem__{file_read,file_write,glob_files,grep_search}`,
  `git__{git_status,git_diff,git_add,git_commit}`).
- **(b) Execution parity**: a single stub `toolExecutor` (delegating to a shared
  `MCPHandler` with a stub tool registered) returns a **deep-equal** result when
  dispatched "under" each harness; `MCPHandler.executeTool` is asserted to be a
  pure `(name, input)` function (harness-agnostic), including its not-found error
  path.
- The `claude-code` branch requires **no Anthropic key / no network** — it is
  exercised purely at the config/registration + MCPHandler layer (no real harness
  instantiated).
- `npm run validate` passes; `npm run test:run` passes with **100% coverage**
  retained on all `src/**/*.ts` (no new src file → no new coverage obligation).

---

## Why

- **PRD §9.4.3 / §9.4.4 / §9.3.3 are the contract.** "Feature parity. All
  features (MCP tools, …) MUST work identically across both harnesses. **Tool
  execution flows through `MCPHandler` for both**, so `pi`'s lack of built-in
  MCP/LSP is **not** a capability gap." The capability table marks MCP as
  "`pi`: via Groundswell `MCPHandler`" and "`claude-code`: built-in **and** via
  `MCPHandler`". This subtask turns that architectural promise into executable
  proof at the hacky-hack integration boundary.
- **Closes the genuine gap.** Existing tests (`tests/integration/groundswell/mcp.test.ts`,
  `tests/integration/mcp-tools.test.ts`, `tests/unit/agents/agent-factory.test.ts`,
  `tests/unit/tools/{bash,filesystem,git}-mcp.test.ts`) all assert tool
  registration/execution for a **single** agent/harness. **None** proves the
  invariance across `pi` vs `claude-code`. PRD §9.4.3 "Feature parity" is
  otherwise un-tested. See `research/mcphandler-and-parity-strategy.md §7`.
- **The architectural fact being locked.** `MCPHandler.executeTool(toolName,
input)` takes **no harness parameter** and dispatches via the per-tool executor
  registered through `registerToolExecutor`. The harness only _reports_ a tool
  call back; the _execution_ is `MCPHandler`-owned and therefore harness-
  independent **by construction** (verified by reading
  `groundswell/core/mcp-handler.ts` — see research §1). The test pins this so a
  future refactor that accidentally makes execution harness-specific fails fast.
- **Pairs with, and is disjoint from, the parallel P1.M2.T2.S2.** S2 covers
  **cache-key** isolation (harness × provider/model). This item covers **tool**
  discovery/execution parity. Disjoint files, disjoint concerns, no merge
  conflict. It is also disjoint from P1.M2.T1.S1 (provider-endpoint guard) and
  P1.M2.T1.S2 (harness/provider **compatibility rejection** — that throws
  `HarnessProviderMismatchError` for `claude-code`+`zai` at `configureHarness()`;
  this test constructs a `harness:'claude-code'` **config object without invoking
  `configureHarness()`**, so no throw and no overlap — see Known Gotchas).
- **Out of scope (hard boundary):** the harness↔provider compatibility guard
  (`src/config/harness.ts`, `HarnessProviderMismatchError` — M2.T1.S2), the
  provider-endpoint guard (`src/config/endpoint-guard.ts` — M2.T1.S1),
  cache-key isolation (M2.T2.S2), docs (M2.T3), any change to `MCP_TOOLS` /
  the tool classes / `agent-factory.ts`, and any new `src/**/*.ts`. This is a
  **test-only** subtask.

---

## What

### User-visible behavior

None at runtime/CLI. This is a pure characterization test. Observable change:
one new green test file under `tests/unit/tools/`. No new env vars, no new public
API, no behavior change anywhere.

### Technical requirements (exact contract)

**`tests/unit/tools/mcp-tool-parity.test.ts`** (CREATE) — a single `describe`
block `MCP tool discovery & execution parity across harnesses (PRD §9.3.3 / §9.4.4)`
with three assertion groups. All determinism comes from stubs; no LLM/network.

**Imports** (exact):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCPHandler,
  type MCPServer,
  type Tool,
  type ToolExecutor, // harness-level: (req:ToolExecutionRequest)=>Promise<ToolExecutionResult>
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from 'groundswell';
import {
  MCP_TOOLS,
  createBaseConfig,
} from '../../../src/agents/agent-factory.js';
```

(`ToolExecutor` / `ToolExecutionRequest` / `ToolExecutionResult` are all
type-exported from the `groundswell` package root — verified in
`dist/types/{providers,harnesses}.d.ts`; see research §4.)

**Hooks**: `beforeEach` stubs the env the way `tests/unit/agents/agent-factory.test.ts`
does (so the global `tests/setup.ts` provider-endpoint guard stays happy and the
agent-factory module-load side effects resolve cleanly):

```ts
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-token');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic'); // NOT Anthropic
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
```

**Group 1 — config/registration layer: both harness configs share the same
tool set, differing only in `harness`**

```ts
// Mirror exactly how the persona factories build configs (createResearcherAgent etc.):
//   { ...createBaseConfig('researcher'), system: PROMPT, mcps: MCP_TOOLS }
function configFor(harness: 'pi' | 'claude-code') {
  return { ...createBaseConfig('researcher'), mcps: MCP_TOOLS, harness };
}

it('both harness configs reference the identical MCP_TOOLS set (object identity)', () => {
  const configPi = configFor('pi');
  const configCc = configFor('claude-code');
  expect(configPi.mcps).toBe(MCP_TOOLS); // same reference, not a copy
  expect(configCc.mcps).toBe(MCP_TOOLS);
  expect(configPi.mcps).toBe(configCc.mcps); // shared across harnesses
});

it('the two configs differ ONLY in the harness field (tools/model/etc. equal)', () => {
  const configPi = configFor('pi');
  const configCc = configFor('claude-code');
  expect(configPi.harness).toBe('pi');
  expect(configCc.harness).toBe('claude-code');
  // every OTHER field is equal — tools are not harness-parameterized
  const { harness: _piH, ...piRest } = configPi;
  const { harness: _ccH, ...ccRest } = configCc;
  expect(piRest).toEqual(ccRest);
});
```

NOTE: constructing `harness:'claude-code'` here does **not** call
`configureHarness()` (that is M2.T1.S2's concern and would throw for
claude-code+zai). We are constructing a plain config object and never executing
it — the compatibility guard is intentionally bypassed and out of scope. Document
this inline with a comment.

**Group 2 — discovery parity: same tool set → identical namespaced names**

```ts
// Mirror MCPHandler.registerServer's namespacing: `${server.name}__${tool.name}`
function discoverToolNames(mcps: MCPServer[]): string[] {
  return mcps
    .flatMap(s => (s.tools ?? []).map(t => `${s.name}__${t.name}`))
    .sort();
}

it('discovers the identical namespaced tool-name set under both harnesses', () => {
  const piNames = discoverToolNames(configFor('pi').mcps as MCPServer[]);
  const ccNames = discoverToolNames(
    configFor('claude-code').mcps as MCPServer[]
  );
  expect(piNames).toEqual(ccNames);
  expect(piNames).toEqual(
    [
      'bash__execute_bash',
      'filesystem__file_read',
      'filesystem__file_write',
      'filesystem__glob_files',
      'filesystem__grep_search',
      'git__git_add',
      'git__git_commit',
      'git__git_diff',
      'git__git_status',
    ].sort()
  );
});

it('the canonical set is exactly 9 tools across 3 inprocess servers', () => {
  expect(MCP_TOOLS).toHaveLength(3);
  expect(discoverToolNames(MCP_TOOLS as MCPServer[])).toHaveLength(9);
  expect((MCP_TOOLS as MCPServer[]).map(m => m.name).sort()).toEqual([
    'bash',
    'filesystem',
    'git',
  ]);
  expect(
    (MCP_TOOLS as MCPServer[]).every(m => m.transport === 'inprocess')
  ).toBe(true);
});
```

**Group 3 — execution parity: tool-execution dispatched through MCPHandler
returns an equivalent result regardless of harness**

```ts
// Fresh, isolated MCPHandler with ONE stub tool — proves the shared dispatch path.
function makeStubbedHandler() {
  const mcp = new MCPHandler();
  const stubTool: Tool = {
    name: 'echo',
    description: 'parity stub',
    input_schema: {
      type: 'object',
      properties: { msg: { type: 'string' } },
      required: ['msg'],
    },
  };
  mcp.registerServer({
    name: 'stub',
    transport: 'inprocess',
    tools: [stubTool],
  });
  const canned = { ok: true, echoed: 'PARITY' };
  mcp.registerToolExecutor('stub', 'echo', async () => canned); // MCPHandler-level executor
  return { mcp, canned };
}

it('a stub toolExecutor delegating to MCPHandler returns an equivalent result under both harnesses', async () => {
  const { mcp, canned } = makeStubbedHandler();
  // The harness-level toolExecutor BOTH harnesses invoke — delegates to MCPHandler.executeTool.
  const toolExecutor: ToolExecutor = vi.fn(
    async (req: ToolExecutionRequest): Promise<ToolExecutionResult> => {
      const r = await mcp.executeTool(req.name, req.input); // ToolResult
      return { content: r.content, isError: Boolean(r.is_error) }; // -> ToolExecutionResult
    }
  );
  const request: ToolExecutionRequest = {
    name: 'stub__echo',
    input: { msg: 'PARITY' },
  };
  const piResult = await toolExecutor(request); // "as the pi harness would dispatch"
  const ccResult = await toolExecutor(request); // "as the claude-code harness would dispatch"
  expect(piResult).toEqual(ccResult); // (b) equivalent
  expect(piResult).toEqual({ content: JSON.stringify(canned), isError: false });
  expect(toolExecutor).toHaveBeenCalledTimes(2); // dispatched once per harness
});

it('MCPHandler.executeTool is a pure (name, input) function — harness-agnostic, incl. the error path', async () => {
  const { mcp } = makeStubbedHandler();
  const r1 = await mcp.executeTool('stub__echo', { msg: 'X' });
  const r2 = await mcp.executeTool('stub__echo', { msg: 'X' });
  expect(r1).toEqual(r2); // deterministic / harness-free
  expect(r1).toMatchObject({ type: 'tool_result', is_error: false });
  // not-found path is ALSO shared (identical for "both" harnesses — same call):
  const miss = await mcp.executeTool('stub__nonexistent', {});
  expect(miss.is_error).toBe(true);
  expect(String(miss.content)).toContain('not found');
});
```

### Success Criteria

- [ ] `tests/unit/tools/mcp-tool-parity.test.ts` exists and is green.
- [ ] (a) Discovery: both harness configs reference `MCP_TOOLS` by identity and
      resolve to the identical 9-name set (3 servers, all `inprocess`).
- [ ] (b) Execution: the stub `toolExecutor` returns deep-equal results across
      both harnesses; `MCPHandler.executeTool` is shown pure `(name, input)`.
- [ ] `claude-code` branch requires no Anthropic key / no network (config +
      MCPHandler layer only; no real harness instantiated).
- [ ] `npm run validate` exits 0; `npm run test:run` exits 0 with 100% coverage
      retained (no new uncovered `src/**/*.ts` file).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?_ **Yes** — the exact file path, every import,
both `beforeEach`/`afterEach` hooks, and all three assertion groups are written
out verbatim with verified type names and the canonical 9 tool names. The two
non-obvious traps are documented with proof: (1) the contract's "mock the
harness execute path" is an **alternative**, not a requirement — the
config/registration-layer strategy is explicitly permitted (research §3); (2)
`createBaseConfig` returns no `mcps` field, so the configs must mirror the
persona-factory spread (research §5). The disjoint-from-siblings boundaries are
enumerated (research §6).

### Documentation & References

```yaml
# MUST READ — PRD sections this item implements
- docfile: PRD.md
  section: "9.4.3 Critical Rules" (h4.11) and "9.4.4 Capability Reference" (h4.12)
  why: >
    §9.4.3 "Feature parity. All features (MCP tools, skills, hooks, AgentResponse,
    caching, workflow events) MUST work identically across both harnesses. Tool
    execution flows through MCPHandler for both, so pi's lack of built-in MCP/LSP
    is NOT a capability gap." §9.4.4 capability table: MCP is "via Groundswell
    MCPHandler" for pi and "built-in AND via MCPHandler" for claude-code.
  critical: The invariant under test is that tool execution is MCPHandler-owned, hence harness-independent.
- docfile: PRD.md
  section: "9.3.3 Agent Runtime & Personas" (h4.7)
  why: "Use MCPHandler to register local system tools. Tools execute locally through
        Groundswell regardless of the active harness; the harness only reports tool calls back."

# MUST READ — this subtask's research (THE load-bearing facts + strategy choice)
- docfile: plan/004_439241a82c24/P1M2T2S1/research/mcphandler-and-parity-strategy.md
  section: "1. MCPHandler surface", "2.1 canonical 9 tool names", "3. strategy pick (B)",
           "4. exact type shapes", "5. createBaseConfig has NO mcps", "6/7. boundaries & existing tests"
  why: >
    The MCPHandler API + the namespacing rule + the canonical tool-name table + the
    two-strategy decision matrix + the exact Groundswell type signatures (Tool /
    ToolResult / MCPServer / ToolExecutionRequest / ToolExecutionResult / the two
    distinct ToolExecutor types) + the disjoint-from-siblings map.
- docfile: plan/004_439241a82c24/P1M2T2S1/research/groundswell-parity-test-reference.md
  section: "2. honest parity matrix", "3. why we do NOT replicate Groundswell's real-harness approach"
  why: >
    Documents why P1.M2.T2.S1 picks the config/registration-layer strategy over
    Groundswell's own real-harness-mocking pattern (scope ownership, fragility,
    dep availability, contract permission, coverage safety). Justifies the
    deviation from the contract's literal "mock the harness execute path" wording.

# MUST READ — the integration boundary under test (hacky-hack's tool set + config builder)
- file: src/agents/agent-factory.ts
  why: MCP_TOOLS (the 3 singletons under test) + createBaseConfig() (config builder
        whose spread the test mirrors) + the persona factories that add `mcps: MCP_TOOLS`.
  pattern: "const MCP_TOOLS: MCPServer[] = [BASH_MCP, FILESYSTEM_MCP, GIT_MCP]; ... { ...baseConfig, system, mcps: MCP_TOOLS }"
  gotcha: createBaseConfig() returns NO `mcps`; importing the module runs
          configureEnvironment() + configureHarness() ONCE (cached) — see Known Gotchas.
- file: src/tools/bash-mcp.ts
  why: VERIFIES the canonical names — server name 'bash', single tool 'execute_bash'
        → 'bash__execute_bash'. Shows the `extends MCPHandler` + self-registering constructor pattern.
- file: src/tools/filesystem-mcp.ts
  why: VERIFIES server 'filesystem' + tools file_read/file_write/glob_files/grep_search.
- file: src/tools/git-mcp.ts
  why: VERIFIES server 'git' + tools git_status/git_diff/git_add/git_commit.

# PATTERN FILES — copy these conventions exactly
- file: tests/unit/agents/agent-factory.test.ts
  why: CLOSEST template — imports MCP_TOOLS + createBaseConfig from agent-factory,
        uses the SAME env-stubbing pattern the parity test needs (ANTHROPIC_AUTH_TOKEN /
        API_KEY / BASE_URL=z.ai), afterEach(vi.unstubAllEnvs()). Asserts config.harness
        and MCP_TOOLS MCPServer-compliance. The parity test is the cross-harness sibling.
  pattern: "beforeEach(() => { vi.stubEnv('ANTHROPIC_AUTH_TOKEN','test-token'); vi.stubEnv('ANTHROPIC_API_KEY','test-token'); vi.stubEnv('ANTHROPIC_BASE_URL','https://api.z.ai/api/anthropic'); }); afterEach(() => vi.unstubAllEnvs());"
  gotcha: importing agent-factory triggers module-load configureHarness() (real, pi+zai → no throw).
          Other files' vi.mock('groundswell') is FILE-SCOPED and does not leak here.

- file: tests/integration/groundswell/mcp.test.ts
  why: Shows the established MCPHandler test idiom in this repo — registerServer /
        registerToolExecutor / getTools / hasTool / executeTool usage + the shared
        `sharedToolExecutor = vi.fn(async req => ({content:..., isError:false}))` stub.
        CONFIRMS the new parity test is DISJOINT (that file tests a single agent; this
        tests cross-harness invariance).
  pattern: "const mcp = new MCPHandler(); mcp.registerServer({name,transport:'inprocess',tools}); mcp.registerToolExecutor(name,tool,fn);"

# CONSUMERS (read-only — proves non-breaking)
- file: tests/setup.ts
  why: The global beforeEach runs validateProviderEndpoint() (reads ANTHROPIC_BASE_URL).
        Stubbing BASE_URL to z.ai in the LOCAL beforeEach keeps the global guard happy.
        Global afterEach already calls vi.unstubAllEnvs(); the local afterEach mirrors it.
- file: src/config/harness.ts
  why: CONSUME (read-only) — the harness/provider MISMATCH guard is SEPARATE (M2.T1.S2).
        The parity test does NOT call configureHarness(); it builds a config object only.

# ARCHITECTURE (authoritative current-vs-target inventory)
- docfile: plan/004_439241a82c24/architecture/external_deps.md
  section: "5. Harness adapters / registry" and "1. Types"
  why: MCPHandler/MCPServer/Tool/ToolExecutor type surface shipped in groundswell@0.0.4.
- docfile: plan/004_439241a82c24/architecture/delta_impact.md
  section: "B. Agent runtime layer" + "E. NOT changing"
  why: Confirms MCP tools (bash/filesystem/git) are NOT being changed by Session 004;
       only config/harness plumbing is. This subtask is test-only against the existing tools.

# PARALLEL-SIBLING CONTRACT (assume implemented as-specified — do not duplicate)
- docfile: plan/004_439241a82c24/P1M2T1S2/PRP.md
  why: The parallel previous item. Defines HarnessProviderMismatchError + the
        configureHarness() throw for claude-code+zai. The parity test INTENTIONALLY
        bypasses configureHarness() (constructs a config object only) so it is disjoint.
```

### Current Codebase tree (relevant slice)

```bash
src/agents/agent-factory.ts     # CONSUME — MCP_TOOLS singletons + createBaseConfig() (no mcps in base)
src/tools/bash-mcp.ts           # CONSUME (read-only) — 'bash' / execute_bash (extends MCPHandler)
src/tools/filesystem-mcp.ts     # CONSUME (read-only) — 'filesystem' / file_read|file_write|glob_files|grep_search
src/tools/git-mcp.ts            # CONSUME (read-only) — 'git' / git_status|git_diff|git_add|git_commit
src/config/harness.ts           # CONSUME (read-only) — SEPARATE mismatch guard (M2.T1.S2); NOT invoked here
tests/unit/tools/
├── bash-mcp.test.ts            # UNCHANGED — per-tool executor unit tests
├── filesystem-mcp.test.ts      # UNCHANGED
├── git-mcp.test.ts             # UNCHANGED
└── mcp-tool-parity.test.ts     # ← THIS SUBTASK CREATES (cross-harness parity)
tests/integration/groundswell/mcp.test.ts  # UNCHANGED — single-agent MCP registration (disjoint)
```

### Desired Codebase tree with files to be added

```bash
tests/unit/tools/mcp-tool-parity.test.ts   # NEW — tool discovery/execution parity across pi vs claude-code (config + MCPHandler layer)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — CONTRACT PERMISSION. The work item says "mock the harness execute
//   path OR assert at the config/registration layer" and "The test must NOT
//   actually require an Anthropic key for the claude-code branch". This subtask
//   picks the config/registration-layer strategy (research §3): NO real
//   PiHarness/ClaudeCodeHarness is instantiated, NO @anthropic-ai/claude-agent-sdk
//   is exercised, NO private-field overwrite, NO LLM. This is explicitly allowed.
//   See research/groundswell-parity-test-reference.md §3 for the full rationale
//   (scope ownership / fragility / dep availability / coverage safety).

// CRITICAL — createBaseConfig() returns NO `mcps` field. The persona factories
//   add it via spread: { ...baseConfig, system, mcps: MCP_TOOLS }. The parity
//   test MUST mirror that spread (configFor() helper) — do NOT expect
//   createBaseConfig('researcher').mcps to exist. See research §5.

// CRITICAL — TWO different ToolExecutor types in Groundswell (research §4):
//   * MCPHandler-level: (input:unknown)=>Promise<unknown>  (registered per-tool)
//   * harness-level:    (req:ToolExecutionRequest)=>Promise<ToolExecutionResult>  (2nd arg to execute())
//   The parity test stubs the HARNESS-level one and delegates to MCPHandler.executeTool
//   (which returns ToolResult {type,tool_use_id,content,is_error?}), mapping to
//   ToolExecutionResult {content,isError}. Don't confuse the two.

// CRITICAL — executeTool RETURN SHAPE. MCPHandler.executeTool returns a ToolResult,
//   NOT a ToolExecutionResult. On success: { type:'tool_result', tool_use_id:'',
//   content: <JSON.stringify(result)> }. The stub maps content through verbatim and
//   isError = Boolean(is_error). The canned object becomes JSON.stringify(canned).

// CRITICAL — namespacing is `server.name + '__' + tool.name` (verified in
//   MCPHandler.registerServer). The 9 canonical names are pinned in Group 2;
//   if a tool name in src/tools/*.ts ever changes, the test fails LOUD — that is
//   the intended regression guard. Re-derive from src/tools/*.ts if needed.

// CRITICAL — DISJOINT FROM M2.T1.S2. That item throws HarnessProviderMismatchError
//   when configureHarness() sees claude-code+zai. This test builds a config OBJECT
//   with harness:'claude-code' WITHOUT calling configureHarness() — so no throw and
//   no overlap. Add an inline comment noting the compatibility guard is intentionally
//   bypassed (we never execute the agent). Do NOT call configureHarness() here.

// GOTCHA — tests/setup.ts registers a global beforeEach running validateProviderEndpoint()
//   (reads process.env.ANTHROPIC_BASE_URL) and a global afterEach calling
//   vi.unstubAllEnvs(). Stub ANTHROPIC_BASE_URL to the z.ai URL in the LOCAL
//   beforeEach (z.ai is allowed; Anthropic is blocked). The global hook runs BEFORE
//   local hooks with a clean env, so stubbing locally is safe (same as
//   agent-factory.test.ts). Mirror that file's hook layout EXACTLY.

// GOTCHA — importing agent-factory runs configureEnvironment() + configureHarness()
//   ONCE at module load (cached). For the default env (PRP_AGENT_HARNESS unset → 'pi',
//   provider 'zai') this is the allowed config → no throw. Do NOT set
//   PRP_AGENT_HARNESS=claude-code anywhere in this file (would make the module-load
//   configureHarness() throw for zai). Leave it unset (→ pi) like agent-factory.test.ts.

// GOTCHA — vi.mock is FILE-SCOPED. This file does NOT vi.mock('groundswell'); it
//   imports the REAL MCPHandler (the alias in vitest.config.ts resolves 'groundswell'
//   → ../groundswell/dist/index.js). Other files' vi.mock('groundswell') does not leak.

// GOTCHA — 100% coverage is enforced (vitest.config.ts include src/**/*.ts). This
//   subtask adds NO new src file (test-only) → NO new coverage obligation. The new
//   test file is in tests/** (excluded from measurement). Groundswell is outside src/**
//   so importing MCPHandler adds nothing to the coverage gate.

// GOTCHA — prettier is an ERROR (eslint prettier/prettier: error). Run `npm run fix`
//   (lint:fix + format) before `npm run validate`. Match the trailing-comma + JSDoc
//   style of agent-factory.test.ts / the existing tests/unit/tools/*.test.ts files.

// GOTCHA — MCP_TOOLS are SINGLETONS (3 module-load instances). Calling read-only
//   methods/fields (.name, .tools, discoverToolNames) is safe and stateless. The
//   execution-parity group uses a FRESH `new MCPHandler()` with a stub server so it
//   shares NO state with the singletons (and cannot hit the "already registered" throw).
```

---

## Implementation Blueprint

### Data models and structure

No new data models. This subtask consumes the existing `MCP_TOOLS` singletons,
`createBaseConfig()`, and the Groundswell types `MCPServer` / `Tool` /
`ToolResult` / `ToolExecutionRequest` / `ToolExecutionResult` / `ToolExecutor`
(re-exported from the `groundswell` package root). The only "structure" is the
test's local helpers: `configFor(harness)`, `discoverToolNames(mcps)`, and
`makeStubbedHandler()` — all defined above in the What section.

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/tools/mcp-tool-parity.test.ts   (RED→GREEN — the whole suite)
  - IMPORT: vitest primitives; MCPHandler + types (MCPServer, Tool, ToolExecutor,
    ToolExecutionRequest, ToolExecutionResult) from 'groundswell'; MCP_TOOLS +
    createBaseConfig from '../../../src/agents/agent-factory.js'.
  - HOOKS: beforeEach (stub ANTHROPIC_AUTH_TOKEN/API_KEY/BASE_URL=z.ai +
    vi.clearAllMocks); afterEach (vi.unstubAllEnvs). Mirror agent-factory.test.ts.
  - HELPERS: configFor(harness), discoverToolNames(mcps), makeStubbedHandler() — verbatim from the What section.
  - GROUP 1 (config/registration layer): 2 its —
      * both harness configs reference identical MCP_TOOLS (toBe identity, 3 ways)
      * configs differ ONLY in harness (strip harness, rest toEqual)
    Add inline comment: claude-code config is constructed WITHOUT calling
    configureHarness(); the compatibility guard (M2.T1.S2) is intentionally bypassed.
  - GROUP 2 (discovery parity): 2 its —
      * identical namespaced name set under both harnesses (toEqual the sorted 9-name list)
      * canonical set = 9 tools / 3 servers / all inprocess
  - GROUP 3 (execution parity): 2 its —
      * stub toolExecutor delegating to MCPHandler returns equivalent result for both harnesses
        (piResult toEqual ccResult; toEqual {content:JSON.stringify(canned), isError:false};
        toolExecutor called twice)
      * MCPHandler.executeTool is pure (name,input) incl. the not-found error path
        (r1 toEqual r2; miss.is_error===true; content contains 'not found')
  - NAMING: describe('MCP tool discovery & execution parity across harnesses (PRD §9.3.3 / §9.4.4)');
    it('...') per case (use the verbatim strings from the What section).
  - PLACEMENT: tests/unit/tools/mcp-tool-parity.test.ts (sibling of bash-mcp.test.ts etc.).
  - EXPECTED: GREEN on first run — this is a CHARACTERIZATION test of an already-shared
    MCPHandler path (PRD §9.3.3). There is nothing new to "wire"; the test pins the invariant.
    (If a Group-3 assertion fails, MCPHandler.executeTool changed shape — investigate;
    do NOT weaken the assertion to force green without understanding why.)

Task 2: FORMAT + VERIFY
  - RUN: npm run fix; then npm run validate;
    then npx vitest run tests/unit/tools/mcp-tool-parity.test.ts;
    then npx vitest run tests/unit/tools/ (all tool tests green);
    then npm run test:run (full regression, 100% coverage retained).
  - EXPECTED: all green. If the full suite regresses, the most likely cause is the
    module-load configureHarness() interaction — confirm PRP_AGENT_HARNESS is unset
    (→ pi) and ANTHROPIC_BASE_URL is stubbed to z.ai, exactly like agent-factory.test.ts.
```

### Implementation Patterns & Key Details

```ts
// ---- tests/unit/tools/mcp-tool-parity.test.ts (NEW — full reference) ----
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCPHandler,
  type MCPServer,
  type Tool,
  type ToolExecutor,
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from 'groundswell';
import {
  MCP_TOOLS,
  createBaseConfig,
} from '../../../src/agents/agent-factory.js';

describe('MCP tool discovery & execution parity across harnesses (PRD §9.3.3 / §9.4.4)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'stubbed-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'stubbed-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic');
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  // Mirror the persona-factory spread: { ...baseConfig, system, mcps: MCP_TOOLS }
  function configFor(harness: 'pi' | 'claude-code') {
    return { ...createBaseConfig('researcher'), mcps: MCP_TOOLS, harness };
  }
  // Mirror MCPHandler.registerServer namespacing.
  function discoverToolNames(mcps: MCPServer[]): string[] {
    return mcps
      .flatMap(s => (s.tools ?? []).map(t => `${s.name}__${t.name}`))
      .sort();
  }

  // ----- Group 1: config/registration layer -----
  it('both harness configs reference the identical MCP_TOOLS set (object identity)', () => {
    const configPi = configFor('pi');
    const configCc = configFor('claude-code');
    // NOTE: we construct a harness:'claude-code' config OBJECT only — we do NOT
    // call configureHarness(), so the claude-code+zai compatibility guard
    // (HarnessProviderMismatchError, owned by P1.M2.T1.S2) is intentionally not
    // triggered and is out of scope. We never execute this agent.
    expect(configPi.mcps).toBe(MCP_TOOLS);
    expect(configCc.mcps).toBe(MCP_TOOLS);
    expect(configPi.mcps).toBe(configCc.mcps);
  });

  it('the two configs differ ONLY in the harness field', () => {
    const { harness: _pi, ...piRest } = configFor('pi');
    const { harness: _cc, ...ccRest } = configFor('claude-code');
    expect(configFor('pi').harness).toBe('pi');
    expect(configFor('claude-code').harness).toBe('claude-code');
    expect(piRest).toEqual(ccRest);
  });

  // ----- Group 2: discovery parity -----
  it('discovers the identical namespaced tool-name set under both harnesses', () => {
    const piNames = discoverToolNames(configFor('pi').mcps as MCPServer[]);
    const ccNames = discoverToolNames(
      configFor('claude-code').mcps as MCPServer[]
    );
    expect(piNames).toEqual(ccNames);
    expect(piNames).toEqual(
      [
        'bash__execute_bash',
        'filesystem__file_read',
        'filesystem__file_write',
        'filesystem__glob_files',
        'filesystem__grep_search',
        'git__git_add',
        'git__git_commit',
        'git__git_diff',
        'git__git_status',
      ].sort()
    );
  });

  it('the canonical set is exactly 9 tools across 3 inprocess servers', () => {
    expect(MCP_TOOLS).toHaveLength(3);
    expect(discoverToolNames(MCP_TOOLS as MCPServer[])).toHaveLength(9);
    expect((MCP_TOOLS as MCPServer[]).map(m => m.name).sort()).toEqual([
      'bash',
      'filesystem',
      'git',
    ]);
    expect(
      (MCP_TOOLS as MCPServer[]).every(m => m.transport === 'inprocess')
    ).toBe(true);
  });

  // ----- Group 3: execution parity through MCPHandler -----
  function makeStubbedHandler() {
    const mcp = new MCPHandler();
    const stubTool: Tool = {
      name: 'echo',
      description: 'parity stub',
      input_schema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg'],
      },
    };
    mcp.registerServer({
      name: 'stub',
      transport: 'inprocess',
      tools: [stubTool],
    });
    const canned = { ok: true, echoed: 'PARITY' };
    mcp.registerToolExecutor('stub', 'echo', async () => canned);
    return { mcp, canned };
  }

  it('a stub toolExecutor delegating to MCPHandler returns an equivalent result under both harnesses', async () => {
    const { mcp, canned } = makeStubbedHandler();
    // The harness-level toolExecutor BOTH harnesses invoke; it delegates to
    // MCPHandler.executeTool — the shared, harness-agnostic dispatch path.
    const toolExecutor: ToolExecutor = vi.fn(
      async (req: ToolExecutionRequest): Promise<ToolExecutionResult> => {
        const r = await mcp.executeTool(req.name, req.input);
        return { content: r.content, isError: Boolean(r.is_error) };
      }
    );
    const request: ToolExecutionRequest = {
      name: 'stub__echo',
      input: { msg: 'PARITY' },
    };
    const piResult = await toolExecutor(request); // "as pi would dispatch"
    const ccResult = await toolExecutor(request); // "as claude-code would dispatch"
    expect(piResult).toEqual(ccResult);
    expect(piResult).toEqual({
      content: JSON.stringify(canned),
      isError: false,
    });
    expect(toolExecutor).toHaveBeenCalledTimes(2);
  });

  it('MCPHandler.executeTool is a pure (name, input) function — harness-agnostic, incl. the error path', async () => {
    const { mcp } = makeStubbedHandler();
    const r1 = await mcp.executeTool('stub__echo', { msg: 'X' });
    const r2 = await mcp.executeTool('stub__echo', { msg: 'X' });
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ type: 'tool_result', is_error: false });
    const miss = await mcp.executeTool('stub__nonexistent', {});
    expect(miss.is_error).toBe(true);
    expect(String(miss.content)).toContain('not found');
  });
});
```

### Integration Points

```yaml
NEW TEST (tests/unit/tools/mcp-tool-parity.test.ts):
  - imports REAL MCPHandler + types from 'groundswell' (vitest alias → ../groundswell/dist/index.js)
  - consumes: MCP_TOOLS + createBaseConfig from src/agents/agent-factory.js
  - no vi.mock of 'groundswell' (uses the real MCPHandler)
  - env: stubs ANTHROPIC_AUTH_TOKEN/API_KEY/BASE_URL(z.ai) in beforeEach; unstubAllEnvs in afterEach
  - no real harness instantiated; no LLM; no network; no Anthropic key

NO CHANGES TO (hard boundary):
  - src/agents/agent-factory.ts, src/tools/*.ts (consumed read-only)
  - src/config/harness.ts, src/config/endpoint-guard.ts, src/config/types.ts (M2.T1.S1/S2 own)
  - any docs/ file (M2.T3)
  - cache-key isolation (M2.T2.S2 — parallel sibling)
  - NO new src/**/*.ts (coverage-safe)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the file — auto-fix first, then verify.
npm run fix                  # = lint:fix + prettier --write
npm run validate             # = lint && format:check && typecheck   (MUST be green)

# Targeted checks (optional, faster feedback):
npx eslint tests/unit/tools/mcp-tool-parity.test.ts
npx tsc --noEmit -p tsconfig.build.json
npx prettier --check tests/unit/tools/mcp-tool-parity.test.ts

# Expected: Zero errors. Most likely failure: a prettier nit (re-run `npm run fix`),
# or a type error if a Groundswell type name was misspelled (the 5 type imports are
# verified re-exported from the package root — see research §4).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass):
npx vitest run tests/unit/tools/mcp-tool-parity.test.ts

# The whole tools suite — proves the new file sits cleanly alongside the per-tool tests:
npx vitest run tests/unit/tools/
# also confirm the config + agent-factory suites still green (we import from agent-factory):
npx vitest run tests/unit/agents/agent-factory.test.ts tests/unit/config/

# Expected: all green. The parity test is a characterization of an already-shared path,
# so it should be green immediately (RED would indicate MCPHandler shape drift — investigate).
```

### Level 3: Integration / Regression (System Validation)

```bash
# Full suite — MUST stay green. This is the proof that:
#  (1) the new parity test passes,
#  (2) importing agent-factory (module-load configureHarness) + the env stubs did NOT
#      regress anything (esp. agent-factory.test.ts and the harness/config suites),
#  (3) global coverage remains 100% (no new uncovered src file — this is test-only).
npm run test:run
npm run test:coverage   # optional: confirm 100% statements/branches/functions/lines on src/**

# Build emits dist/ cleanly (proves the test file compiles via tsc):
npx tsc -p tsconfig.build.json

# Expected: full suite green; coverage at 100%; build succeeds.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No network/LLM/MCP-server-process/DB in this subtask — pure config + MCPHandler-in-memory.
# Domain-specific reasoning (record in commit message):
#   1. Harness-independence proof (PRD §9.3.3/§9.4.3/§9.4.4): tool execution flows through
#      MCPHandler for BOTH harnesses. Group 3 proves executeTool is a pure (name, input)
#      function — it takes no harness argument and dispatches via the per-tool executor.
#      The harness only REPORTS the tool call; the result is MCPHandler-owned, hence
#      byte-identical across pi vs claude-code. This is a STRONGER equivalence claim than
#      Groundswell's own hook-level shape parity (see research/groundswell-parity-test-reference.md §2).
#   2. Contract fidelity: the work item offered "mock the harness execute path OR assert at
#      the config/registration layer" and required "no Anthropic key for the claude-code
#      branch". We chose config/registration + direct MCPHandler execution (research §3) —
#      no real harness, no SDK, no key, no network. Document this choice + the "canned
#      ToolExecutionResult vs AgentResponse" precision note in the commit message.
#   3. Disjointness: this test does NOT call configureHarness() (so claude-code+zai does
#      NOT throw here — that is M2.T1.S2's concern) and does NOT touch the endpoint guard
#      (M2.T1.S1) or cache keys (M2.T2.S2). Pure tool-layer parity.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run validate` exits 0 (lint + format:check + typecheck).
- [ ] `npx vitest run tests/unit/tools/mcp-tool-parity.test.ts` exits 0.
- [ ] `npm run test:run` (full suite) exits 0 — no regression (esp. `agent-factory.test.ts`,
      the `tests/unit/config/` suites, and `tests/unit/tools/`).
- [ ] Global coverage remains 100% (no new uncovered `src/**/*.ts` file).
- [ ] `npx tsc -p tsconfig.build.json` compiles with no errors.

### Feature Validation

- [ ] Group 1: both harness configs reference `MCP_TOOLS` by identity (`toBe`, 3 ways);
      configs differ ONLY in `harness` (stripped rest `toEqual`).
- [ ] Group 2: identical 9-element namespaced name set under both harnesses; canonical
      set = 9 tools / 3 servers (`bash`,`filesystem`,`git`) / all `inprocess`.
- [ ] Group 3: stub `toolExecutor` returns deep-equal results across both harnesses
      (`piResult toEqual ccResult`, `toEqual {content:JSON.stringify(canned), isError:false}`,
      called twice); `MCPHandler.executeTool` is pure `(name,input)` incl. the not-found
      error path (`is_error:true`, content contains `not found`).
- [ ] `claude-code` branch required no Anthropic key / no network (no real harness run).

### Code Quality Validation

- [ ] New test file follows `agent-factory.test.ts` conventions (env stubbing in
      `beforeEach`, `afterEach(vi.unstubAllEnvs)`, ESM `.js` specifiers, no `any`).
- [ ] Inline comment documents the intentional bypass of `configureHarness()` (disjoint
      from M2.T1.S2's compatibility guard).
- [ ] No `vi.mock('groundswell')` (uses the real `MCPHandler`); no real harness/LLM/network.
- [ ] No new `src/**/*.ts` created (coverage-safe); test placed in `tests/unit/tools/`.
- [ ] Asserts EQUIVALENCE of the MCPHandler-owned result, not the asymmetric harness-hook
      metadata (per the honest parity matrix, research §2).

### Documentation & Deployment

- [ ] Commit message documents: (1) the parity invariant pinned (PRD §9.3.3/§9.4.3/§9.4.4);
      (2) the config/registration-layer strategy choice + why not the real-harness-mock
      path (research §3); (3) the `ToolExecutionResult` precision vs the contract's literal
      "canned AgentResponse" wording; (4) disjointness from M2.T1.S1/S2 and M2.T2.S2.
- [ ] No new env vars introduced (consumes existing `ANTHROPIC_*` stubs only).

---

## Anti-Patterns to Avoid

- ❌ Don't instantiate real `PiHarness` / `ClaudeCodeHarness` or overwrite their private
  `sdk` field — that is Groundswell's own `harness-parity.test.ts` pattern and is
  heavyweight, fragile, SDK-dependent, and outside hacky-hack's ownership. Use the
  config/registration-layer strategy (explicitly permitted by the contract). See research §3.
- ❌ Don't call `configureHarness()` (or `configureHarnesses()`) in this test — that is
  M2.T1.S2's surface and would throw for `claude-code`+`zai`. Construct a config OBJECT
  with `harness:'claude-code'` only; never execute the agent.
- ❌ Don't expect `createBaseConfig('researcher').mcps` to exist — base config has NO
  `mcps` field. Mirror the persona-factory spread (`{ ...baseConfig, mcps: MCP_TOOLS }`).
- ❌ Don't confuse the two `ToolExecutor` types. The MCPHandler-level one is
  `(input)=>Promise<unknown>`; the harness-level one (what you stub) is
  `(req:ToolExecutionRequest)=>Promise<ToolExecutionResult>`. The stub delegates the
  former via `mcp.executeTool` and maps `ToolResult`→`ToolExecutionResult`.
- ❌ Don't assert value-equality on harness-reported hook metadata (`onToolEnd` `isError`/
  `duration`) — those are asymmetric across harnesses (CC hard-codes `false`/`0`). Assert
  equivalence of the **MCPHandler-owned** result, which is genuinely identical.
- ❌ Don't hardcode the 9 tool names from memory — re-derive from `src/tools/*.ts` if a
  Group-2 assertion fails (a mismatch is a real regression, not a test bug). The names
  above are verified against the current source.
- ❌ Don't set `PRP_AGENT_HARNESS=claude-code` anywhere in this file — it would make the
  agent-factory module-load `configureHarness()` throw for `zai`. Leave it unset (→ `pi`).
- ❌ Don't stub `ANTHROPIC_BASE_URL` to an Anthropic URL — the global `tests/setup.ts`
  guard will throw. Stub to the z.ai URL (as `agent-factory.test.ts` does).
- ❌ Don't create any new `src/**/*.ts` file (would add a coverage obligation) — this is a
  test-only subtask.
- ❌ Don't `vi.mock('groundswell')` — the test needs the REAL `MCPHandler`. (Other files'
  file-scoped mocks won't leak in.)
- ❌ Don't weaken a Group-3 assertion to force green without understanding why — this is a
  characterization test of an already-shared path; a RED means `MCPHandler.executeTool`'s
  contract drifted, which must be investigated, not papered over.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a single, self-contained test file with no production-code change and
no new coverage obligation. Every import (verified re-exported from the `groundswell`
package root), every hook (copied from the already-green `agent-factory.test.ts`), every
assertion (with the canonical 9 tool names verified against `src/tools/*.ts`), and every
helper is written out verbatim in the What section + Implementation Patterns. The
architectural fact under test — `MCPHandler.executeTool` takes no harness argument and is
thus harness-independent — is verified by direct reading of
`groundswell/core/mcp-handler.ts` (research §1). The genuinely novel decision — choosing
the config/registration-layer strategy over Groundswell's heavyweight real-harness-mock
pattern — is documented with a full rationale (research §3 + the honest parity matrix in
the reference note) and is explicitly permitted by the work-item contract's "OR" clause.
The two non-obvious traps (createBaseConfig has no `mcps`; two distinct `ToolExecutor`
types) are spelled out in the Gotchas with the exact workaround. Residual risks: (a) a
prettier nit (auto-fixed via `npm run fix`); (b) a misspelled Groundswell type name (all 5
type imports are verified present in `dist/types/*.d.ts` — research §4); (c) the
module-load `configureHarness()` interaction if env stubbing is omitted (mitigated by
copying `agent-factory.test.ts`'s hook layout exactly). None are structural.
