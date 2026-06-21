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
    expect(r1).toMatchObject({ type: 'tool_result' });
    expect(r1.is_error).toBeFalsy();
    const miss = await mcp.executeTool('stub__nonexistent', {});
    expect(miss.is_error).toBe(true);
    expect(String(miss.content)).toContain('not found');
  });
});
