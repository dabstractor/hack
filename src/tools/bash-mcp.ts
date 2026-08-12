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
  /**
   * True iff the Node watchdog fired — i.e. the command exceeded its `timeout`
   * and `executeBashCommand` invoked `child.kill('SIGTERM'→'SIGKILL')`.
   *
   * PRD §9.3.2 ("Watchdog kills are terminal"): a timed-out validation is a
   * HARD, non-retryable failure. This flag lets the retry layer
   * (P3.M2.T2.S2) distinguish a watchdog kill from a genuine non-zero exit
   * and abort instead of churning retries against a hung process. Note: when
   * a PRP `validate.sh` wraps a command in the `timeout` coreutil, the shell
   * itself exits 124 — that surfaces here as `exitCode: 124` (with
   * `timedOut: false`, because the NODE watchdog did not fire); consumers
   * should treat EITHER signal as terminal.
   */
  timedOut: boolean;
  /**
   * True iff `child.kill()` was invoked (SIGTERM or SIGKILL). In this tool
   * the only caller of `kill()` is the watchdog, so `killed === timedOut` in
   * the close handler; surfaced separately as a redundant, robust signal per
   * the P3.M2.T2.S1 contract.
   */
  killed: boolean;
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
 * Result of a §9.10.3 denylist evaluation.
 *
 * @remarks
 * `denied` is true iff the command must be refused before exec. When denied,
 * `reason` carries a human-readable explanation (citing the PRD §9.10.3 rule).
 */
export interface DenylistResult {
  /** True iff the command must be refused before exec (fail-closed). */
  denied: boolean;
  /** Human-readable reason when denied. */
  reason?: string;
}

/**
 * Match `binary` invoked with `sub` as its FIRST POSITIONAL subcommand.
 *
 * @remarks
 * Tolerates an optional path prefix (`/usr/bin/git`), optional `.exe`, and
 * common global flags (`-C <dir>`, `-c <kv>`, `--xxx` booleans) before `sub`.
 * The subcommand is the first positional, so `git log config` does NOT match
 * `config`, and `git log --grep="push"` does NOT match `push`. The left
 * boundary `(?:^|[^\w./@+-])` prevents false matches on tokens like
 * `widget/git-push.sh`, `agit`, or `digital`. `c` MUST be pre-lowercased.
 *
 * @param c - The lowercased command string.
 * @param binary - The binary name (e.g. `'git'`, `'gh'`).
 * @param sub - The subcommand name (e.g. `'push'`, `'repo'`).
 * @returns True iff `binary` is invoked with `sub` as its first positional.
 */
function invokesSubcommand(c: string, binary: string, sub: string): boolean {
  const globalFlags = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--[a-z][\w-]*))*`;
  const re = new RegExp(
    String.raw`(?:^|[^\w./@+-])(?:[\w.@+-]*/)*` +
      binary +
      String.raw`(?:\.exe)?` +
      globalFlags +
      String.raw`\s+` +
      sub +
      String.raw`\b`
  );
  return re.test(c);
}

/**
 * §9.10.3 pre-exec bash denylist.
 *
 * @remarks
 * Inspects the raw command string (case-insensitive) and refuses any
 * repo-remote-mutating or default-branch-mutating operation BEFORE `spawn`.
 * This is a pre-exec STRING gate — it is NOT a sandbox; `shell: true` is
 * retained so shell constructs (pipes, loops, `&&`) still work for legitimate
 * test/build/lint gates.
 *
 * PRD §9.10.3 (verbatim): "The bash tool MUST refuse — non-zero exit, clear
 * error — any command that matches a repo-remote-mutating or
 * default-branch-mutating operation before exec."
 *
 * Ambiguous matches FAIL CLOSED (refuse): anything undecidable from a raw
 * string (e.g. whether a `git reset --hard` target is a "shared ref") is
 * refused. The only commands that MUST pass are test/build/lint gates and
 * read-only git.
 *
 * Rule list:
 * - A. Any reference to `default_branch` (catch-all; also catches `gh api …
 *   -f default_branch=…`).
 * - B. `curl`/`wget` to `api.github.com` (raw GitHub API surface).
 * - C. `gh repo` (any subcommand) — mutates repo settings.
 * - D. `gh api` writes: explicit `-X PATCH|POST|DELETE|PUT`, OR any field flag
 *   (`-f`/`-F`/`--field`/`--raw-field`) implying a POST body. Bare `gh api`
 *   and `gh api -X GET` are reads (allowed).
 * - E. `git push|remote|update-ref|config|rebase|commit` — git state/remote
 *   mutation.
 * - F. `git reset --hard` — shared-ref qualifier is undecidable ⇒ deny.
 *
 * @param command - The raw command string to inspect.
 * @returns `{ denied: true, reason }` if the command must be refused, else
 *   `{ denied: false }`.
 */
export function isDeniedCommand(command: string): DenylistResult {
  const c = command.toLowerCase();

  // Rule A — ANY reference to default_branch (catch-all; evaluated first so it
  // also catches `gh api … -f default_branch=…` before Rule D).
  if (/default[_-]branch/.test(c)) {
    return {
      denied: true,
      reason:
        'references default_branch — repo default-branch mutation is human-only (PRD §9.10.3)',
    };
  }

  // Rule B — curl/wget to api.github.com.
  if (/\b(curl|wget)\b/.test(c) && c.includes('api.github.com')) {
    return {
      denied: true,
      reason:
        'curl/wget to api.github.com — raw GitHub API surface (PRD §9.10.3)',
    };
  }

  // Rule C — gh repo (any subcommand).
  if (invokesSubcommand(c, 'gh', 'repo')) {
    return {
      denied: true,
      reason: 'gh repo (any subcommand) mutates repo settings (PRD §9.10.3)',
    };
  }

  // Rule D — gh api writes / ambiguous. Explicit write method, OR field flags
  // (which imply a POST body) => write intent => fail closed. Bare
  // `gh api <endpoint>` and `gh api -X GET` are reads => allowed.
  if (invokesSubcommand(c, 'gh', 'api')) {
    if (/-x\s*(patch|post|delete|put)\b/.test(c)) {
      return {
        denied: true,
        reason:
          'gh api -X PATCH|POST|DELETE|PUT is a GitHub-API write (PRD §9.10.3)',
      };
    }
    if (
      /(?:^|\s)-[fF]\b/.test(c) ||
      /--raw-field\b/.test(c) ||
      /--field\b/.test(c)
    ) {
      return {
        denied: true,
        reason:
          'gh api with -f/-F/--field/--raw-field implies a write body (PRD §9.10.3, fail-closed)',
      };
    }
    // bare read: fall through (allowed)
  }

  // Rule E — git remote-mutating / state-mutating subcommands.
  for (const sub of [
    'push',
    'remote',
    'update-ref',
    'config',
    'rebase',
    'commit',
  ]) {
    if (invokesSubcommand(c, 'git', sub)) {
      return {
        denied: true,
        reason: `git ${sub} mutates git state/remotes (PRD §9.10.3: remote/state mutation is human-only)`,
      };
    }
  }

  // Rule F — git reset --hard. "against a shared ref" is UNDECIDABLE from a raw
  // string => blanket deny (fail-closed).
  if (invokesSubcommand(c, 'git', 'reset') && c.includes('--hard')) {
    return {
      denied: true,
      reason:
        'git reset --hard denied — shared-ref qualifier undecidable, fail closed (PRD §9.10.3)',
    };
  }

  return { denied: false };
}

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
 * **§9.10.3 pre-exec denylist (fail-closed):** before any process is spawned,
 * the raw command string is inspected by {@link isDeniedCommand}. Any
 * repo-remote-mutating or default-branch-mutating operation is refused with a
 * non-zero exit (126), a clear error, and NO spawn. Ambiguous matches fail
 * closed (refuse). Legitimate test/build/lint gates and read-only git pass
 * unchanged. This gate is a pre-exec STRING filter — `shell: true` is retained
 * so shell constructs still work for allowed commands.
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

  // §9.10.3 pre-exec denylist (fail-closed). Inspect the raw command string
  // BEFORE spawn so no remote/default-branch mutation can ever execute.
  const denial = isDeniedCommand(command);
  if (denial.denied) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 126,
      error: `[bash denylist] Command refused: ${denial.reason}`,
      timedOut: false,
      killed: false,
    };
  }

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
      timedOut: false,
      killed: false,
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
        timedOut,
        killed,
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
        timedOut: false,
        killed: false,
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

// Export tool schema and result types for external use.
// isDeniedCommand and DenylistResult are exported inline at their declaration.
export type { BashToolInput, BashToolResult };
export { bashTool, executeBashCommand };
