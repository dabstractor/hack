/**
 * File system utilities for session management
 *
 * @module core/session-utils
 *
 * @remarks
 * Provides type-safe, error-handled file system operations for session management.
 * These utilities are used by the Session Manager to create sessions, persist state,
 * and manage PRP documents without any file system concerns.
 *
 * All functions use the custom {@link SessionFileError} class for consistent error
 * handling. Critical write operations use atomic patterns (temp file + rename) to
 * prevent data corruption if the process crashes during write.
 *
 * @example
 * ```typescript
 * import { hashPRD, createSessionDirectory, writeTasksJSON } from './core/session-utils.js';
 *
 * const hash = await hashPRD('/path/to/PRD.md');
 * const sessionPath = await createSessionDirectory('/path/to/PRD.md', 1);
 * await writeTasksJSON(sessionPath, backlog);
 * ```
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { TextDecoder } from 'node:util';
import { getLogger, type Logger } from '../utils/logger.js';
import type { Backlog, PRPDocument } from './models.js';
import { BacklogSchema, PRPDocumentSchema } from './models.js';

/**
 * Logger instance for session-utils debug logging
 */
let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('session-utils'));

/**
 * Error thrown when a session file operation fails
 *
 * @remarks
 * This error is thrown by all session utility functions when file system
 * operations fail. Captures the path, operation, and underlying error code
 * for debugging and error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await readFile(path, 'utf-8');
 * } catch (error) {
 *   throw new SessionFileError(path, 'read PRD', error as Error);
 * }
 * ```
 */
export class SessionFileError extends Error {
  /** File/path where the error occurred */
  readonly path: string;

  /** Description of the operation being performed */
  readonly operation: string;

  /** Node.js errno code (ENOENT, EACCES, etc.) if available */
  readonly code?: string;

  /**
   * Creates a new SessionFileError
   *
   * @param path - File/path where error occurred
   * @param operation - Description of operation being performed
   * @param cause - Underlying error that caused this failure
   */
  constructor(path: string, operation: string, cause?: Error) {
    const err = cause as NodeJS.ErrnoException;
    super(
      `Failed to ${operation} at ${path}: ${err?.message ?? 'unknown error'}`
    );
    this.name = 'SessionFileError';
    this.path = path;
    this.operation = operation;
    this.code = err?.code;
  }
}

/**
 * Atomically writes data to a file using temp file + rename pattern
 *
 * @remarks
 * This internal helper implements the atomic write pattern used by
 * writeTasksJSON and writePRP. Writing to a temp file first, then renaming,
 * ensures that the target file is never partially written (rename is atomic
 * on the same filesystem). If the process crashes between write and rename,
 * the target file remains untouched.
 *
 * @param targetPath - Final destination path for the file
 * @param data - String content to write
 * @throws {SessionFileError} If write or rename fails
 */
export async function atomicWrite(
  targetPath: string,
  data: string
): Promise<void> {
  const tempPath = resolve(
    dirname(targetPath),
    `.${basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`
  );

  logger().debug(
    {
      targetPath,
      tempPath,
      size: data.length,
      operation: 'atomicWrite',
    },
    'Starting atomic write'
  );

  try {
    const writeStart = performance.now();
    await writeFile(tempPath, data, { mode: 0o644 });
    const writeDuration = performance.now() - writeStart;

    logger().debug(
      {
        tempPath,
        size: data.length,
        duration: writeDuration,
        operation: 'writeFile',
      },
      'Temp file written'
    );

    const renameStart = performance.now();
    await rename(tempPath, targetPath);
    const renameDuration = performance.now() - renameStart;

    logger().debug(
      {
        tempPath,
        targetPath,
        duration: renameDuration,
        operation: 'rename',
      },
      'Temp file renamed to target'
    );

    logger().debug(
      {
        targetPath,
        size: data.length,
        totalDuration: writeDuration + renameDuration,
      },
      'Atomic write completed successfully'
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        targetPath,
        tempPath,
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'atomicWrite',
      },
      'Atomic write failed'
    );

    // Clean up temp file on error
    try {
      await unlink(tempPath);
      logger().debug(
        { tempPath, operation: 'cleanup' },
        'Temp file cleaned up'
      );
    } catch (cleanupError) {
      logger().warn(
        {
          tempPath,
          cleanupErrorCode: (cleanupError as NodeJS.ErrnoException)?.code,
        },
        'Failed to clean up temp file'
      );
    }
    throw new SessionFileError(targetPath, 'atomic write', error as Error);
  }
}

/**
 * Reads a file with strict UTF-8 validation
 *
 * @remarks
 * Reads a file as a buffer and validates UTF-8 encoding using TextDecoder
 * with fatal: true. This prevents silent data corruption from invalid UTF-8
 * sequences.
 *
 * @param path - File path to read
 * @param operation - Description of operation for error messages
 * @returns Promise resolving to file content as string
 * @throws {SessionFileError} If file cannot be read or contains invalid UTF-8
 */
export async function readUTF8FileStrict(
  path: string,
  operation: string
): Promise<string> {
  try {
    const buffer = await readFile(path);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch (error) {
    throw new SessionFileError(path, operation, error as Error);
  }
}

/**
 * Computes SHA-256 hash of a PRD file
 *
 * @remarks
 * Reads the file content and computes the SHA-256 hash using Node.js crypto.
 * Returns the full 64-character hexadecimal hash string. The session hash
 * (first 12 characters) is extracted from this value by createSessionDirectory.
 *
 * Used for PRD delta detection - if the hash changes, a delta session is needed.
 *
 * @param prdPath - Absolute or relative path to the PRD markdown file
 * @returns Promise resolving to 64-character hexadecimal hash string
 * @throws {SessionFileError} If file cannot be read
 *
 * @example
 * ```typescript
 * const hash = await hashPRD('/path/to/PRD.md');
 * // Returns: '14b9dc2a33c7a1234567890abcdef...'
 * console.log(hash.length); // 64
 * ```
 */
export async function hashPRD(prdPath: string): Promise<string> {
  try {
    logger().debug(
      { prdPath, operation: 'hashPRD' },
      'Reading PRD for hash computation'
    );
    const content = await readFile(prdPath, 'utf-8');
    const fullHash = createHash('sha256').update(content).digest('hex');
    logger().debug(
      { prdPath, hash: fullHash.slice(0, 12), fullHashLength: fullHash.length },
      'PRD hash computed'
    );
    return fullHash;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        prdPath,
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'hashPRD',
      },
      'Failed to read PRD for hashing'
    );
    throw new SessionFileError(prdPath, 'read PRD', error as Error);
  }
}

/**
 * Creates the complete session directory structure
 *
 * @remarks
 * Creates a session directory at `{planDir}/{sequence}_{hash}/` where:
 * - `sequence` is zero-padded to 3 digits (e.g., '001', '002')
 * - `hash` is the first 12 characters of the PRD's SHA-256 hash
 *
 * Creates the following subdirectories:
 * - `architecture/` - Architectural research findings
 * - `prps/` - Generated PRP documents
 * - `artifacts/` - Temporary implementation artifacts
 *
 * The `EEXIST` error is handled gracefully - if the directory already exists,
 * no error is thrown. This enables idempotent calls.
 *
 * @param prdPath - Path to PRD file for hash computation
 * @param sequence - Session sequence number (will be zero-padded to 3 digits)
 * @param planDir - Directory to create sessions in (defaults to resolve('plan'))
 * @returns Promise resolving to absolute path of created session directory
 * @throws {SessionFileError} If directory creation fails
 *
 * @example
 * ```typescript
 * const sessionPath = await createSessionDirectory('/path/to/PRD.md', 1);
 * // Returns: '/absolute/path/to/plan/001_14b9dc2a33c7'
 * ```
 */
export async function createSessionDirectory(
  prdPath: string,
  sequence: number,
  planDir: string = resolve('plan')
): Promise<string> {
  try {
    // Compute PRD hash
    const fullHash = await hashPRD(prdPath);
    const sessionHash = fullHash.slice(0, 12);

    logger().debug({ prdPath, sessionHash, sequence }, 'Session hash computed');

    // Build session ID and path
    const sessionId = `${String(sequence).padStart(3, '0')}_${sessionHash}`;
    const sessionPath = join(planDir, sessionId);

    // Create directory structure
    const directories = [
      sessionPath,
      join(sessionPath, 'architecture'),
      join(sessionPath, 'prps'),
      join(sessionPath, 'artifacts'),
    ];

    logger().debug(
      {
        sessionId,
        sessionPath,
        directories: ['.', 'architecture', 'prps', 'artifacts'],
        operation: 'createDirectoryStructure',
      },
      'Creating session directory structure'
    );

    for (const dir of directories) {
      const dirName = basename(dir);
      logger().debug(
        { dir, dirName, operation: 'mkdir' },
        'Creating subdirectory'
      );
      try {
        await mkdir(dir, { recursive: true, mode: 0o755 });
        logger().debug({ dir, result: 'created' }, 'Subdirectory created');
      } catch (error: unknown) {
        // EEXIST is OK (directory already exists)
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'EEXIST') {
          logger().error(
            {
              dir,
              errorCode: err?.code,
              errorMessage: err?.message,
              operation: 'mkdir',
            },
            'Failed to create subdirectory'
          );
          throw error;
        }
        logger().debug(
          { dir, result: 'exists' },
          'Subdirectory already exists'
        );
      }
    }

    logger().info({ sessionId, sessionPath }, 'Session directory created');

    return sessionPath;
  } catch (error) {
    if (error instanceof SessionFileError) {
      throw error;
    }
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        prdPath,
        sequence,
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'createSessionDirectory',
      },
      'Failed to create session directory'
    );
    throw new SessionFileError(
      prdPath,
      'create session directory',
      error as Error
    );
  }
}

/**
 * Atomically writes tasks.json to session directory
 *
 * @remarks
 * Validates the backlog with Zod schema before writing, then uses atomic
 * write pattern (temp file + rename) to prevent corruption if the process
 * crashes during write.
 *
 * The tasks.json file is the single source of truth for the task hierarchy
 * in a session. It must be written atomically to ensure data integrity.
 *
 * @param sessionPath - Absolute path to session directory
 * @param backlog - Backlog object to write
 * @throws {SessionFileError} If validation or write fails
 *
 * @example
 * ```typescript
 * const backlog: Backlog = { backlog: [/* ... *\/] };
 * await writeTasksJSON('/path/to/session', backlog);
 * // Creates: /path/to/session/tasks.json
 * ```
 */
export async function writeTasksJSON(
  sessionPath: string,
  backlog: Backlog
): Promise<void> {
  try {
    logger().debug(
      {
        sessionPath,
        itemCount: backlog.backlog.length,
        operation: 'writeTasksJSON',
      },
      'Writing tasks.json'
    );

    // Validate with Zod schema
    const validated = BacklogSchema.parse(backlog);

    logger().debug(
      {
        sessionPath,
        validated: true,
        itemCount: validated.backlog.length,
      },
      'Backlog validated successfully'
    );

    // Serialize to JSON with 2-space indentation
    const content = JSON.stringify(validated, null, 2);

    // Write atomically
    const tasksPath = resolve(sessionPath, 'tasks.json');

    logger().debug(
      {
        tasksPath,
        size: content.length,
        operation: 'atomicWrite',
      },
      'Writing tasks.json atomically'
    );

    await atomicWrite(tasksPath, content);

    logger().info(
      {
        tasksPath,
        size: content.length,
      },
      'tasks.json written successfully'
    );
  } catch (error) {
    if (error instanceof SessionFileError) {
      // SessionFileError from atomicWrite - already logged, just re-throw
      throw error;
    }
    // Zod validation error or other error
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        sessionPath,
        tasksPath: resolve(sessionPath, 'tasks.json'),
        errorCode: err?.code ?? (error as Error).constructor.name,
        errorMessage: err?.message ?? (error as Error).message,
        operation: 'writeTasksJSON',
      },
      'Failed to write tasks.json'
    );
    throw new SessionFileError(
      resolve(sessionPath, 'tasks.json'),
      'write tasks.json',
      error as Error
    );
  }
}

/**
 * Reads and validates tasks.json from session directory
 *
 * @remarks
 * Reads the tasks.json file, parses the JSON content, and validates with
 * Zod schema to ensure the data matches the expected Backlog structure.
 *
 * This is the counterpart to writeTasksJSON - use it to load the task
 * hierarchy when resuming a session or initializing the Session Manager.
 *
 * @param sessionPath - Absolute path to session directory
 * @returns Promise resolving to validated Backlog object
 * @throws {SessionFileError} If file cannot be read or is invalid
 *
 * @example
 * ```typescript
 * const backlog = await readTasksJSON('/path/to/session');
 * console.log(backlog.backlog.length); // Number of phases
 * ```
 */
export async function readTasksJSON(sessionPath: string): Promise<Backlog> {
  try {
    logger().debug(
      {
        sessionPath,
        operation: 'readTasksJSON',
      },
      'Reading tasks.json'
    );

    const tasksPath = resolve(sessionPath, 'tasks.json');
    const content = await readFile(tasksPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = BacklogSchema.parse(parsed);

    logger().debug(
      {
        sessionPath,
        itemCount: validated.backlog.length,
      },
      'tasks.json read successfully'
    );

    return validated;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        sessionPath,
        tasksPath: resolve(sessionPath, 'tasks.json'),
        errorCode: err?.code ?? (error as Error).constructor.name,
        errorMessage: err?.message ?? (error as Error).message,
        operation: 'readTasksJSON',
      },
      'Failed to read tasks.json'
    );
    throw new SessionFileError(
      resolve(sessionPath, 'tasks.json'),
      'read tasks.json',
      error as Error
    );
  }
}

/**
 * Converts PRPDocument to markdown format
 *
 * @remarks
 * Internal helper that converts a PRPDocument object to markdown string
 * following the PRP template structure from PROMPTS.md. The markdown includes
 * all sections: header, objective, context, implementation steps, validation
 * gates, success criteria, and references.
 *
 * @param prp - PRP document to convert
 * @returns Markdown string representation of the PRP
 * @internal
 */
function prpToMarkdown(prp: PRPDocument): string {
  const sections: string[] = [];

  // Header
  sections.push(`# ${prp.taskId}`);
  sections.push('');

  // Objective
  sections.push('## Objective');
  sections.push('');
  sections.push(prp.objective);
  sections.push('');

  // Context
  sections.push('## Context');
  sections.push('');
  sections.push(prp.context);
  sections.push('');

  // Implementation Steps
  sections.push('## Implementation Steps');
  sections.push('');
  prp.implementationSteps.forEach((step, i) => {
    sections.push(`${i + 1}. ${step}`);
  });
  sections.push('');

  // Validation Gates
  sections.push('## Validation Gates');
  sections.push('');
  prp.validationGates.forEach(gate => {
    sections.push(`### Level ${gate.level}`);
    sections.push('');
    sections.push(gate.description);
    if (gate.manual) {
      sections.push('');
      sections.push('*Manual validation required*');
    } else if (gate.command !== null && gate.command !== undefined) {
      sections.push('');
      sections.push('```bash');
      sections.push(gate.command);
      sections.push('```');
    }
    sections.push('');
  });

  // Success Criteria
  sections.push('## Success Criteria');
  sections.push('');
  prp.successCriteria.forEach(criterion => {
    const checkbox = criterion.satisfied ? '[x]' : '[ ]';
    sections.push(`- ${checkbox} ${criterion.description}`);
  });
  sections.push('');

  // References
  sections.push('## References');
  sections.push('');
  prp.references.forEach(ref => {
    sections.push(`- ${ref}`);
  });

  return sections.join('\n');
}

/**
 * Writes PRP document to prps/ subdirectory as markdown
 *
 * @remarks
 * Validates the PRP with Zod schema before writing, converts to markdown
 * format, then uses atomic write pattern to prevent corruption.
 *
 * PRP files are stored at `prps/{taskId}.md` in the session directory.
 * Each PRP represents a complete implementation specification for a
 * single subtask in the task hierarchy.
 *
 * @param sessionPath - Absolute path to session directory
 * @param taskId - Task ID for filename (e.g., 'P1.M2.T2.S3')
 * @param prp - PRP document to write
 * @throws {SessionFileError} If validation or write fails
 *
 * @example
 * ```typescript
 * const prp: PRPDocument = { /* ... *\/ };
 * await writePRP('/path/to/session', 'P1.M2.T2.S3', prp);
 * // Creates: /path/to/session/prps/P1.M2.T2.S3.md
 * ```
 */
export async function writePRP(
  sessionPath: string,
  taskId: string,
  prp: PRPDocument
): Promise<void> {
  try {
    // Validate with Zod schema
    const validated = PRPDocumentSchema.parse(prp);

    // Convert to markdown
    const content = prpToMarkdown(validated);

    // Write atomically
    const prpPath = resolve(sessionPath, 'prps', `${taskId}.md`);
    await atomicWrite(prpPath, content);
  } catch (error) {
    if (error instanceof SessionFileError) {
      throw error;
    }
    throw new SessionFileError(
      resolve(sessionPath, 'prps', `${taskId}.md`),
      'write PRP',
      error as Error
    );
  }
}

/**
 * Creates a PRD snapshot in the session directory
 *
 * @remarks
 * Reads the PRD file content with strict UTF-8 validation and writes it to
 * `prd_snapshot.md` in the session directory. This snapshot preserves a frozen
 * copy of the PRD for reference during implementation.
 *
 * The snapshot is created with mode 0o644 (owner read/write, group/others read-only).
 *
 * @param sessionPath - Path to session directory
 * @param prdPath - Path to PRD markdown file
 * @throws {SessionFileError} If PRD cannot be read, has invalid UTF-8, or snapshot cannot be written
 *
 * @example
 * ```typescript
 * await snapshotPRD('/path/to/session', '/path/to/PRD.md');
 * // Creates: /path/to/session/prd_snapshot.md
 * ```
 */
export async function snapshotPRD(
  sessionPath: string,
  prdPath: string
): Promise<void> {
  try {
    logger().debug(
      {
        sessionPath,
        prdPath,
        operation: 'snapshotPRD',
      },
      'Creating PRD snapshot'
    );

    // Resolve absolute paths
    const absSessionPath = resolve(sessionPath);
    const absPRDPath = resolve(prdPath);

    // Read PRD with strict UTF-8 validation
    const content = await readUTF8FileStrict(absPRDPath, 'read PRD');

    logger().debug(
      {
        prdPath: absPRDPath,
        size: content.length,
      },
      'PRD content read for snapshot'
    );

    // Build snapshot path
    const snapshotPath = resolve(absSessionPath, 'prd_snapshot.md');

    // Write snapshot with mode 0o644
    logger().debug(
      {
        snapshotPath,
        size: content.length,
        mode: 0o644,
        operation: 'writeFile',
      },
      'Writing PRD snapshot'
    );

    await writeFile(snapshotPath, content, { mode: 0o644 });

    logger().info(
      {
        snapshotPath,
        size: content.length,
      },
      'PRD snapshot created successfully'
    );
  } catch (error) {
    // Re-throw SessionFileError without wrapping
    if (error instanceof SessionFileError) {
      // Log before re-throwing for visibility
      logger().debug(
        {
          sessionPath,
          prdPath,
          snapshotPath: resolve(sessionPath, 'prd_snapshot.md'),
        },
        'Re-throwing SessionFileError from snapshotPRD'
      );
      throw error;
    }
    // Wrap unexpected errors in SessionFileError
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        sessionPath,
        prdPath,
        snapshotPath: resolve(sessionPath, 'prd_snapshot.md'),
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'snapshotPRD',
      },
      'Failed to create PRD snapshot'
    );
    throw new SessionFileError(
      resolve(sessionPath, 'prd_snapshot.md'),
      'write PRD snapshot',
      error as Error
    );
  }
}

/**
 * Loads a PRD snapshot from the session directory
 *
 * @remarks
 * Reads the `prd_snapshot.md` file from the session directory with strict UTF-8
 * validation and returns its content. This is the counterpart to snapshotPRD.
 *
 * @param sessionPath - Path to session directory
 * @returns Promise resolving to PRD snapshot content
 * @throws {SessionFileError} If snapshot file cannot be read or has invalid UTF-8
 *
 * @example
 * ```typescript
 * const content = await loadSnapshot('/path/to/session');
 * console.log(content); // PRD markdown content
 * ```
 */
export async function loadSnapshot(sessionPath: string): Promise<string> {
  logger().debug(
    {
      sessionPath,
      operation: 'loadSnapshot',
    },
    'Loading PRD snapshot'
  );

  // Resolve absolute path
  const absSessionPath = resolve(sessionPath);
  const snapshotPath = resolve(absSessionPath, 'prd_snapshot.md');

  try {
    // Read snapshot with strict UTF-8 validation
    const content = await readUTF8FileStrict(snapshotPath, 'read PRD snapshot');

    logger().debug(
      {
        sessionPath,
        snapshotPath,
        size: content.length,
      },
      'PRD snapshot loaded'
    );

    return content;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        sessionPath,
        snapshotPath,
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'loadSnapshot',
      },
      'Failed to load PRD snapshot'
    );
    throw error;
  }
}
