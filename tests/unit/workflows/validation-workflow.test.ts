/**
 * Unit tests for ValidationWorkflow class
 *
 * @remarks
 * Tests validate ValidationWorkflow class from
 * `src/workflows/validation-workflow.ts` with comprehensive coverage (mirrors
 * `tests/unit/workflows/bug-hunt-workflow.test.ts`, ADDITIONALLY mocking
 * `BashMCP`). Tests follow the Setup/Execute/Verify pattern.
 *
 * Mocks are used for all agent + bash operations — no real I/O is performed.
 *
 * @see {@link https://vitest.dev/guide/ | Vitest Documentation}
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ValidationWorkflow } from '../../../src/workflows/validation-workflow.js';

// Hoisted mock state so factory + test bodies share references.
const { mockReadFile, mockExecuteBash, MockBashMCP } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockExecuteBash: vi.fn(),
  MockBashMCP: vi.fn(),
}));

// Mock agent factory
vi.mock('../../../src/agents/agent-factory.js', () => ({
  createQAAgent: vi.fn(),
}));

// Mock validation prompt
vi.mock('../../../src/agents/prompts/validation-prompt.js', () => ({
  createValidationPrompt: vi.fn(),
}));

// Mock node:fs/promises for the file-as-contract read-back in generateScript
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

// Mock BashMCP — the direct (non-MCP) execute_bash path used by runScript.
// Returning a class keeps `new BashMCP()` working.
vi.mock('../../../src/tools/bash-mcp.js', () => ({
  BashMCP: MockBashMCP.mockImplementation(() => ({
    execute_bash: mockExecuteBash,
  })),
}));

// Mock constants so the timeout budget + agent id are deterministic.
vi.mock('../../../src/config/constants.js', () => ({
  getValidationAgent: vi.fn().mockReturnValue('pizr'),
  getValidationTimeoutSeconds: vi.fn().mockReturnValue(7200),
}));

// Import mocked modules
import { createQAAgent } from '../../../src/agents/agent-factory.js';
import { createValidationPrompt } from '../../../src/agents/prompts/validation-prompt.js';
import { getValidationTimeoutSeconds } from '../../../src/config/constants.js';

// Cast mocked functions
const mockCreateQAAgent = createQAAgent as any;
const mockCreateValidationPrompt = createValidationPrompt as any;

describe('ValidationWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mocks
    mockCreateQAAgent.mockReturnValue({
      prompt: vi.fn().mockResolvedValue({
        status: 'success',
        data: null,
        error: null,
        metadata: { agentId: 'test-validation-agent', timestamp: Date.now() },
      }),
    });
    mockCreateValidationPrompt.mockReturnValue({ user: 'test prompt' });
    // By default the agent wrote a non-empty validate.sh.
    mockReadFile.mockResolvedValue(
      '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n'
    );
    // By default execute_bash succeeds (exit 0).
    mockExecuteBash.mockResolvedValue({
      success: true,
      stdout: 'all good',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      killed: false,
    });
  });

  describe('constructor', () => {
    it('should throw if prdContent is empty', () => {
      expect(() => new ValidationWorkflow('', '/repo')).toThrow(
        'prdContent must be a non-empty string'
      );
    });

    it('should throw if prdContent is only whitespace', () => {
      expect(() => new ValidationWorkflow('   ', '/repo')).toThrow(
        'prdContent must be a non-empty string'
      );
    });

    it('should throw if codebasePath is empty', () => {
      expect(() => new ValidationWorkflow('PRD', '')).toThrow(
        'codebasePath must be a non-empty string'
      );
    });

    it('should store prdContent and codebasePath', () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      expect(workflow.prdContent).toBe('PRD content');
      expect(workflow.codebasePath).toBe('/repo');
      expect(workflow.outcome).toBeNull();
    });
  });

  describe('generateScript', () => {
    it('should throw if sessionPath is unset', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await expect(workflow.generateScript()).rejects.toThrow(
        'sessionPath required'
      );
    });

    it('should call createQAAgent + createValidationPrompt with scriptPath', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      const scriptPath = await workflow.generateScript();

      expect(mockCreateQAAgent).toHaveBeenCalledTimes(1);
      expect(mockCreateValidationPrompt).toHaveBeenCalledWith(
        'PRD content',
        '/repo',
        expect.stringContaining('validate.sh')
      );
      expect(scriptPath).toBe('/session/validate.sh');
    });

    it('should call agent.prompt with the prompt', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      const prompt = { user: 'test prompt' };
      const mockAgent = {
        prompt: vi.fn().mockResolvedValue({ status: 'success' }),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);
      mockCreateValidationPrompt.mockReturnValue(prompt);

      await workflow.generateScript();

      expect(mockAgent.prompt).toHaveBeenCalledWith(prompt);
    });

    it('should throw if validate.sh is missing (empty) after the agent runs', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      mockReadFile.mockResolvedValue('   \n  '); // whitespace-only

      await expect(workflow.generateScript()).rejects.toThrow(
        /did not write a non-empty validate.sh/
      );
    });

    it('should throw if readFile rejects (file missing)', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await expect(workflow.generateScript()).rejects.toThrow(
        /validate.sh generation failed/
      );
    });

    it('should propagate errors from agent.prompt', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      (workflow as any).sessionPath = '/session';
      const mockAgent = {
        prompt: vi.fn().mockRejectedValue(new Error('LLM down')),
      };
      mockCreateQAAgent.mockReturnValue(mockAgent);

      await expect(workflow.generateScript()).rejects.toThrow(
        /validate.sh generation failed/
      );
    });
  });

  describe('runScript', () => {
    it('should return success:true on exit 0', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.runScript('/session/validate.sh');

      expect(outcome.success).toBe(true);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.timedOut).toBe(false);
      expect(outcome.stdout).toBe('all good');
      expect(outcome.scriptPath).toBe('/session/validate.sh');
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
      expect(workflow.outcome).toBe(outcome);
    });

    it('should return success:false + timedOut:false on a non-zero exit (not 124)', async () => {
      mockExecuteBash.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'lint failed',
        exitCode: 1,
        timedOut: false,
        killed: false,
      });

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.runScript('/session/validate.sh');

      expect(outcome.success).toBe(false);
      expect(outcome.exitCode).toBe(1);
      expect(outcome.timedOut).toBe(false);
    });

    it('should return timedOut:true on a Node-watchdog kill (timedOut:true)', async () => {
      mockExecuteBash.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: 137,
        timedOut: true,
        killed: true,
      });

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.runScript('/session/validate.sh');

      expect(outcome.success).toBe(false);
      expect(outcome.timedOut).toBe(true);
      expect(outcome.exitCode).toBe(137);
    });

    it('should return timedOut:true on a `timeout`-coreutil exit 124 (timedOut:false)', async () => {
      mockExecuteBash.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: '',
        exitCode: 124,
        timedOut: false,
        killed: false,
      });

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.runScript('/session/validate.sh');

      expect(outcome.success).toBe(false);
      expect(outcome.timedOut).toBe(true); // 124 → terminal
      expect(outcome.exitCode).toBe(124);
    });

    it('should pass timeout = getValidationTimeoutSeconds()*1000 to execute_bash', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await workflow.runScript('/session/validate.sh');

      const expected = getValidationTimeoutSeconds() * 1000; // 7200*1000
      expect(mockExecuteBash).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: expected })
      );
    });

    it('should pass cwd = process.cwd() to execute_bash', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await workflow.runScript('/session/validate.sh');

      expect(mockExecuteBash).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: process.cwd() })
      );
    });

    it('should run `bash <abs>/validate.sh`', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await workflow.runScript('/abs/session/validate.sh');

      expect(mockExecuteBash).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'bash /abs/session/validate.sh' })
      );
    });

    it('should propagate errors from execute_bash', async () => {
      mockExecuteBash.mockRejectedValue(new Error('spawn failed'));

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await expect(workflow.runScript('/session/validate.sh')).rejects.toThrow(
        'spawn failed'
      );
    });
  });

  describe('run', () => {
    it('should run generateScript then runScript and return the outcome', async () => {
      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.run('/session');

      expect(mockCreateQAAgent).toHaveBeenCalledTimes(1);
      expect(mockExecuteBash).toHaveBeenCalledTimes(1);
      expect(outcome.success).toBe(true);
      expect(outcome.scriptPath).toContain('validate.sh');
    });

    it('should NOT throw on a non-zero exit (the pipeline owns the abort)', async () => {
      mockExecuteBash.mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'failed',
        exitCode: 2,
        timedOut: false,
        killed: false,
      });

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      const outcome = await workflow.run('/session');

      // Non-zero exits return an outcome; the PIPELINE throws ValidationFailedError.
      expect(outcome.success).toBe(false);
      expect(outcome.exitCode).toBe(2);
    });

    it('should rethrow generation errors', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const workflow = new ValidationWorkflow('PRD content', '/repo');
      await expect(workflow.run('/session')).rejects.toThrow(
        /validate.sh generation failed/
      );
    });
  });
});
