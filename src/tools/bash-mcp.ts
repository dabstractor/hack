/**
 * Bash MCP Tool Module
 *
 * @module tools/bash-mcp
 *
 * @remarks
 * Provides MCP tool for executing shell commands safely.
 * Uses spawn() with argument arrays to prevent shell injection.
 * Implements timeout protection and output capture.
 *
 * @example
 * ```ts
 * import { BashMCP } from './tools/bash-mcp.js';
 *
 * const bashMCP = new BashMCP();
 * const result = await bashMCP.executeTool('bash__execute_bash', {
 *   command: 'npm test',
 *   cwd: './my-project',
 *   timeout: 60000
 * });
 * ```
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCPHandler, type Tool } from 'groundswell';

/**
 * Input schema for bash tool execution
 *
 * @remarks
 * Contains the parameters accepted by the execute_bash tool.
 * The command is required, while cwd and timeout are optional.
 */
interface BashToolInput {
  /** The shell command to execute */
  command: string;
  /** Working directory (optional, defaults to process.cwd()) */
  cwd?: string;
  /** Timeout in milliseconds (optional, defaults to 30000) */
  timeout?: number;
}

/**
 * Result from bash command execution
 *
 * @remarks
 * Contains the execution results including captured output,
 * exit status, and any error messages.
 */
interface BashToolResult {
  /** True if command succeeded (exit code 0) */
  success: boolean;
  /** Standard output from command */
  stdout: string;
  /** Standard error from command */
  stderr: string;
  /** Exit code from process (null if spawn failed) */
  exitCode: number | null;
  /** Error message if spawn failed or timed out */
  error?: string;
}

/**
 * Default timeout for command execution in milliseconds
 *
 * @remarks
 * Commands that run longer than 30 seconds will be terminated.
 * Can be overridden per command via the timeout parameter.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Tool schema definition for Groundswell
 *
 * @remarks
 * Defines the execute_bash tool with JSON Schema input validation.
 * Requires 'command' string, optional 'cwd' string, optional 'timeout' number.
 * Timeout is constrained between 1000ms and 300000ms for safety.
 */
const bashTool: Tool = {
  name: 'execute_bash',
  description:
    'Execute shell commands with optional working directory and timeout. ' +
    'Returns stdout, stderr, exit code, and success status. ' +
    'Commands are executed safely using spawn() without shell interpretation.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution (optional)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        minimum: 1000,
        maximum: 300000,
      },
    },
    required: ['command'],
  },
};

/**
 * Execute a bash command safely with timeout and output capture
 *
 * @remarks
 * Uses spawn() with argument arrays to prevent shell injection.
 * Implements SIGTERM then SIGKILL timeout handling.
 * Captures stdout, stderr, and exit code for result.
 *
 * @param input - Tool input with command, optional cwd, optional timeout
 * @returns Promise resolving to execution result
 *
 * @example
 * ```ts
 * const result = await executeBashCommand({
 *   command: 'npm test',
 *   cwd: './project',
 *   timeout: 60000
 * });
 * // { success: true, stdout: '...', stderr: '', exitCode: 0 }
 * ```
 */
async function executeBashCommand(
  input: BashToolInput
): Promise<BashToolResult> {
  const { command, cwd, timeout = DEFAULT_TIMEOUT } = input;

  // PATTERN: Validate working directory exists
  const workingDir =
    typeof cwd === 'string'
      ? (() => {
          const absoluteCwd = resolve(cwd);
          if (!existsSync(absoluteCwd)) {
            throw new Error(`Working directory does not exist: ${absoluteCwd}`);
          }
          return realpathSync(absoluteCwd);
        })()
      : undefined;

  let child: ChildProcess;

  // CRITICAL: Run the command via the system shell (shell: true) so that
  // shell constructs (for/while loops, &&, ||, pipes, redirects, $()) work.
  // The prior implementation split on spaces with shell:false, which meant
  // only a single bare binary (npx, npm) could execute — ANY validation gate
  // using `for ... done`, `&&`, or `|` would silently fail with exitCode:null.
  // The full command string is passed to /bin/sh -c by Node's spawn.
  try {
    child = spawn(command, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
  } catch (error) {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    // PATTERN: Set up timeout handler
    const timeoutId = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGTERM');

      // PATTERN: Force kill after grace period
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2000);
    }, timeout);

    // PATTERN: Capture stdout data
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        if (killed) return;
        stdout += data.toString();
      });
    }

    // PATTERN: Capture stderr data
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        if (killed) return;
        stderr += data.toString();
      });
    }

    // PATTERN: Handle process completion
    child.on('close', exitCode => {
      clearTimeout(timeoutId);

      const result: BashToolResult = {
        success: exitCode === 0 && !timedOut && !killed,
        stdout,
        stderr,
        exitCode,
      };

      if (timedOut) {
        result.error = `Command timed out after ${timeout}ms`;
      } else if (exitCode !== 0) {
        result.error = `Command failed with exit code ${exitCode}`;
      }

      resolve(result);
    });

    // PATTERN: Handle spawn errors (command not found, etc.)
    child.on('error', (error: Error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        error: error.message,
      });
    });
  });
}

/**
 * Bash MCP Server
 *
 * @remarks
 * Groundswell MCP server that provides bash command execution.
 * Extends MCPHandler and registers the execute_bash tool.
 * Also provides direct execute_bash method for synchronous use.
 */
export class BashMCP extends MCPHandler {
  /** Server name for MCPServer interface */
  public readonly name = 'bash';

  /** Transport type for MCPServer interface */
  public readonly transport = 'inprocess' as const;

  /** Tools for MCPServer interface */
  public readonly tools = [bashTool];

  constructor() {
    super();

    // PATTERN: Register server in constructor
    this.registerServer({
      name: this.name,
      transport: this.transport,
      tools: this.tools,
    });

    // PATTERN: Register tool executor
    this.registerToolExecutor('bash', 'execute_bash', async (input: unknown) =>
      executeBashCommand(input as BashToolInput)
    );
  }

  /**
   * Execute a bash command directly (non-MCP path)
   *
   * @remarks
   * Provides direct access to bash execution for components that need
   * to run commands outside of the MCP tool framework. This is used
   * by PRPExecutor to run validation gates.
   *
   * @param input - Tool input with command, optional cwd, optional timeout
   * @returns Promise resolving to execution result
   *
   * @example
   * ```typescript
   * const bashMCP = new BashMCP();
   * const result = await bashMCP.execute_bash({
   *   command: 'npm test',
   *   cwd: process.cwd()
   * });
   * ```
   */
  async execute_bash(input: BashToolInput): Promise<BashToolResult> {
    return executeBashCommand(input);
  }
}

// Export tool schema and result types for external use
export type { BashToolInput, BashToolResult };
export { bashTool, executeBashCommand };
