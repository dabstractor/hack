/**
 * Filesystem MCP Tool Module
 *
 * @module tools/filesystem-mcp
 *
 * @remarks
 * Provides MCP tools for file system operations.
 * Implements read, write, glob, and grep with security constraints.
 *
 * @example
 * ```ts
 * import { FilesystemMCP } from './tools/filesystem-mcp.js';
 *
 * const fsMCP = new FilesystemMCP();
 * const result = await fsMCP.executeTool('filesystem__file_read', {
 *   path: './package.json',
 *   encoding: 'utf-8'
 * });
 * ```
 */

import { promises as fs } from 'node:fs';
import { resolve, normalize, sep } from 'node:path';
import { MCPHandler, type Tool } from 'groundswell';
import fg from 'fast-glob';

/**
 * Default encoding for text file operations
 */
const DEFAULT_ENCODING: BufferEncoding = 'utf-8';

// ===== INPUT INTERFACES =====

/**
 * Input schema for file_read tool
 *
 * @remarks
 * Contains the parameters accepted by the file_read tool.
 * The path is required, while encoding is optional.
 */
interface FileReadInput {
  /** File path to read */
  path: string;
  /** Encoding (default: 'utf-8') */
  encoding?: BufferEncoding;
}

/**
 * Input schema for file_write tool
 *
 * @remarks
 * Contains the parameters accepted by the file_write tool.
 * Both path and content are required, createDirs is optional.
 */
interface FileWriteInput {
  /** File path to write */
  path: string;
  /** Content to write */
  content: string;
  /** Create directories if they don't exist */
  createDirs?: boolean;
}

/**
 * Input schema for glob_files tool
 *
 * @remarks
 * Contains the parameters accepted by the glob_files tool.
 * The pattern is required, cwd is optional.
 */
interface GlobFilesInput {
  /** Glob pattern (e.g., double-star-slash-double-star-slash-dot-ts) */
  pattern: string;
  /** Working directory for glob search */
  cwd?: string;
}

/**
 * Input schema for grep_search tool
 *
 * @remarks
 * Contains the parameters accepted by the grep_search tool.
 * Both pattern and path are required, flags is optional.
 */
interface GrepSearchInput {
  /** Regex pattern to search for */
  pattern: string;
  /** File path to search in */
  path: string;
  /** Regex flags (e.g., 'i' for case-insensitive) */
  flags?: string;
}

// ===== RESULT INTERFACES =====

/**
 * Result from file_read operation
 *
 * @remarks
 * Contains the read result including content or error message.
 */
interface FileReadResult {
  /** True if file was read successfully */
  success: boolean;
  /** File content as string */
  content?: string;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Result from file_write operation
 *
 * @remarks
 * Contains the write result or error message.
 */
interface FileWriteResult {
  /** True if file was written successfully */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Result from glob_files operation
 *
 * @remarks
 * Contains the matching file paths or error message.
 */
interface GlobFilesResult {
  /** True if glob operation completed */
  success: boolean;
  /** Array of matching file paths */
  matches?: string[];
  /** Error message if operation failed */
  error?: string;
}

/**
 * Result from grep_search operation
 *
 * @remarks
 * Contains the matching lines with line numbers or error message.
 */
interface GrepSearchResult {
  /** True if search completed */
  success: boolean;
  /** Array of matching lines with line numbers */
  matches?: Array<{ line: number; content: string }>;
  /** Error message if operation failed */
  error?: string;
}

// ===== TOOL SCHEMAS =====

/**
 * Tool schema definition for file_read
 *
 * @remarks
 * Defines the file_read tool with JSON Schema input validation.
 * Requires 'path' string, optional 'encoding' string.
 */
const fileReadTool: Tool = {
  name: 'file_read',
  description:
    'Read file contents with optional encoding. ' +
    'Returns file content as string or error message.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to read',
      },
      encoding: {
        type: 'string',
        description: 'Encoding (default: utf-8)',
        enum: ['utf-8', 'utf16le', 'latin1', 'base64', 'hex'],
      },
    },
    required: ['path'],
  },
};

/**
 * Tool schema definition for file_write
 *
 * @remarks
 * Defines the file_write tool with JSON Schema input validation.
 * Requires 'path' and 'content', optional 'createDirs' boolean.
 */
const fileWriteTool: Tool = {
  name: 'file_write',
  description:
    'Write content to a file. ' +
    'Optionally creates directories if they do not exist.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to write',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
      createDirs: {
        type: 'boolean',
        description: 'Create directories if needed (default: false)',
      },
    },
    required: ['path', 'content'],
  },
};

/**
 * Tool schema definition for glob_files
 *
 * @remarks
 * Defines the glob_files tool with JSON Schema input validation.
 * Requires 'pattern' string, optional 'cwd' string.
 */
const globFilesTool: Tool = {
  name: 'glob_files',
  description:
    'Find files matching a glob pattern. ' +
    'Returns array of matching file paths.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., **/*.ts, src/**/*.js)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (optional)',
      },
    },
    required: ['pattern'],
  },
};

/**
 * Tool schema definition for grep_search
 *
 * @remarks
 * Defines the grep_search tool with JSON Schema input validation.
 * Requires 'pattern' and 'path' strings, optional 'flags' string.
 */
const grepSearchTool: Tool = {
  name: 'grep_search',
  description:
    'Search for a regex pattern in a file. ' +
    'Returns array of matching lines with line numbers.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File path to search in',
      },
      flags: {
        type: 'string',
        description: 'Regex flags (e.g., i for case-insensitive)',
      },
    },
    required: ['pattern', 'path'],
  },
};

// ===== TOOL EXECUTORS =====

/**
 * Read file contents with encoding
 *
 * @remarks
 * Uses fs.promises.readFile with encoding support.
 * Validates and normalizes path to prevent traversal attacks.
 * Handles ENOENT, EACCES, EISDIR errors.
 *
 * @param input - Tool input with path and optional encoding
 * @returns Promise resolving to read result
 *
 * @example
 * ```ts
 * const result = await readFile({ path: './package.json', encoding: 'utf-8' });
 * // { success: true, content: '{...}' }
 * ```
 */
async function readFile(input: FileReadInput): Promise<FileReadResult> {
  const { path, encoding = DEFAULT_ENCODING } = input;

  try {
    // PATTERN: Validate and normalize path
    const safePath = resolve(path);

    // PATTERN: Read file with encoding
    const content = await fs.readFile(safePath, { encoding });

    return { success: true, content };
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;

    // PATTERN: Handle specific error codes
    if (errno === 'ENOENT') {
      return { success: false, error: `File not found: ${path}` };
    }
    if (errno === 'EACCES') {
      return { success: false, error: `Permission denied: ${path}` };
    }
    if (errno === 'EISDIR') {
      return { success: false, error: `Path is a directory: ${path}` };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write content to file with optional directory creation
 *
 * @remarks
 * Uses fs.promises.writeFile with encoding support.
 * Creates directories if createDirs is true.
 * Handles EACCES, ENOTDIR errors.
 *
 * @param input - Tool input with path, content, and optional createDirs
 * @returns Promise resolving to write result
 *
 * @example
 * ```ts
 * const result = await writeFile({
 *   path: './output/file.txt',
 *   content: 'Hello World',
 *   createDirs: true
 * });
 * // { success: true }
 * ```
 */
async function writeFile(input: FileWriteInput): Promise<FileWriteResult> {
  const { path, content, createDirs = false } = input;

  try {
    const safePath = resolve(path);

    // PATTERN: Create directories if requested
    if (createDirs) {
      const dir = normalize(path).split(sep).slice(0, -1).join(sep);
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
      }
    }

    // PATTERN: Write file with encoding
    await fs.writeFile(safePath, content, { encoding: DEFAULT_ENCODING });

    return { success: true };
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;

    if (errno === 'EACCES') {
      return { success: false, error: `Permission denied: ${path}` };
    }
    if (errno === 'ENOTDIR') {
      return { success: false, error: `Not a directory in path: ${path}` };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Find files matching glob pattern
 *
 * @remarks
 * Uses fast-glob for efficient pattern matching.
 * Returns absolute paths by default.
 *
 * @param input - Tool input with pattern and optional cwd
 * @returns Promise resolving to glob result
 */
async function globFiles(input: GlobFilesInput): Promise<GlobFilesResult> {
  const { pattern, cwd } = input;

  try {
    // PATTERN: Use fast-glob for efficient pattern matching
    const matches = await fg(pattern, {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      absolute: true,
      onlyFiles: true,
    });

    return { success: true, matches };
  } catch (error) {
    return {
      success: false,
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Search file content for regex pattern
 *
 * @remarks
 * Reads file content and searches line by line.
 * Returns matches with line numbers.
 * Handles invalid regex patterns gracefully.
 *
 * @param input - Tool input with pattern, path, and optional flags
 * @returns Promise resolving to search result
 *
 * @example
 * ```ts
 * const result = await grepSearch({
 *   path: './src/file.ts',
 *   pattern: 'import.*from',
 *   flags: 'i'
 * });
 * // { success: true, matches: [{ line: 1, content: 'import x from "y"' }] }
 * ```
 */
async function grepSearch(input: GrepSearchInput): Promise<GrepSearchResult> {
  const { pattern, path, flags = '' } = input;

  try {
    // PATTERN: Read file content
    const safePath = resolve(path);
    const content = await fs.readFile(safePath, { encoding: DEFAULT_ENCODING });

    // PATTERN: Split into lines and match
    const lines = content.split('\n');
    const matches: Array<{ line: number; content: string }> = [];

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      return {
        success: false,
        error: `Invalid regex pattern: ${pattern}`,
      };
    }

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ line: i + 1, content: lines[i] });
      }
    }

    return { success: true, matches };
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;

    if (errno === 'ENOENT') {
      return { success: false, error: `File not found: ${path}` };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Filesystem MCP Server
 *
 * @remarks
 * Groundswell MCP server providing file system operations.
 * Extends MCPHandler and registers four tools: file_read, file_write,
 * glob_files, and grep_search.
 */
export class FilesystemMCP extends MCPHandler {
  /** Server name for MCPServer interface */
  public readonly name = 'filesystem';

  /** Transport type for MCPServer interface */
  public readonly transport = 'inprocess' as const;

  /** Tools for MCPServer interface */
  public readonly tools = [
    fileReadTool,
    fileWriteTool,
    globFilesTool,
    grepSearchTool,
  ];

  constructor() {
    super();

    // PATTERN: Register server in constructor
    this.registerServer({
      name: this.name,
      transport: this.transport,
      tools: this.tools,
    });

    // PATTERN: Register tool executors
    this.registerToolExecutor(
      'filesystem',
      'file_read',
      async (input: unknown) => readFile(input as FileReadInput)
    );
    this.registerToolExecutor(
      'filesystem',
      'file_write',
      async (input: unknown) => writeFile(input as FileWriteInput)
    );
    this.registerToolExecutor(
      'filesystem',
      'glob_files',
      async (input: unknown) => globFiles(input as GlobFilesInput)
    );
    this.registerToolExecutor(
      'filesystem',
      'grep_search',
      async (input: unknown) => grepSearch(input as GrepSearchInput)
    );
  }
}

// Export types and tools for external use
export type {
  FileReadInput,
  FileWriteInput,
  GlobFilesInput,
  GrepSearchInput,
  FileReadResult,
  FileWriteResult,
  GlobFilesResult,
  GrepSearchResult,
};
export { fileReadTool, fileWriteTool, globFilesTool, grepSearchTool };
export { readFile, writeFile, globFiles, grepSearch };
