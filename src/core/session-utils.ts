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
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  stat,
} from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { TextDecoder } from 'node:util';
import { getLogger, type Logger } from '../utils/logger.js';
import {
  getPrdIncludeMaxDepth,
  getPrdIncludeMarkers,
} from '../config/constants.js';
import type { Backlog, DeltaAnalysis, PRPDocument } from './models.js';
import {
  BacklogSchema,
  BacklogReadSchema,
  PRPDocumentSchema,
} from './models.js';

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
 * Hash the fully-resolved PRD document (PRD §2.3 / §4.1 step 2).
 *
 * @remarks
 * Pure: no filesystem I/O. This is the canonical "hash a resolved document" primitive.
 * Callers that already hold resolved content (e.g. {@link SessionManager.initialize}, which resolves
 * once and feeds the SAME string to the hash AND the snapshot) use this directly to avoid a second
 * resolution. Callers with only a path use {@link hashPRD}, which resolves then delegates here.
 *
 * Hashing the RESOLVED (include-expanded) document — never the raw entry file — is what guarantees
 * hash/snapshot/delta consistency for distributed (multi-file) PRDs (PRD §2.3 "Single canonical
 * document downstream"). Idempotency of {@link resolvePRD} (S3) makes a single resolution safe.
 *
 * @param resolved - The fully include-expanded PRD document.
 * @returns 64-character lowercase-hex SHA-256 digest.
 */
export function hashPRDContent(resolved: string): string {
  const fullHash = createHash('sha256').update(resolved).digest('hex');
  logger().debug(
    { hash: fullHash.slice(0, 12), fullHashLength: fullHash.length },
    'Resolved PRD hash computed'
  );
  return fullHash;
}

/**
 * Computes SHA-256 hash of a PRD file (over the resolved document).
 *
 * @remarks
 * Resolves the PRD entry file via {@link resolvePRD} (expanding `@`-includes, PRD §2.3), then
 * delegates to {@link hashPRDContent}. The hash is therefore computed over the FULLY-RESOLVED,
 * include-expanded document — never the raw entry file. This guarantees hash/snapshot/delta
 * consistency for distributed (multi-file) PRDs (PRD §2.3 / §4.1 step 2).
 *
 * Used for PRD delta detection - if the hash changes, a delta session is needed.
 *
 * @param prdPath - Absolute or relative path to the PRD markdown file
 * @returns Promise resolving to 64-character hexadecimal hash string
 * @throws {SessionFileError} If the entry file (or any included file) cannot be read / is
 *         invalid UTF-8, or a `stat` fails with a non-ENOENT error.
 *
 * @example
 * ```typescript
 * const hash = await hashPRD('/path/to/PRD.md');
 * // Returns: '14b9dc2a33c7a1234567890abcdef...' (64 hex chars)
 * console.log(hash.length); // 64
 * ```
 */
export async function hashPRD(prdPath: string): Promise<string> {
  try {
    logger().debug(
      { prdPath, operation: 'hashPRD' },
      'Resolving + hashing PRD'
    );
    const resolved = await resolvePRD(prdPath); // PRD §2.3: hash the resolved document
    return hashPRDContent(resolved);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    logger().error(
      {
        prdPath,
        errorCode: err?.code,
        errorMessage: err?.message,
        operation: 'hashPRD',
      },
      'Failed to resolve/hash PRD'
    );
    // resolvePRD/readUTF8FileStrict already wrap in SessionFileError(prdPath, 'read PRD', …),
    // preserving the pre-refactor error envelope (operation 'read PRD'). Re-throw as-is.
    throw error;
  }
}

/**
 * Tokenizer for `@path/to/file.md` include directives (PRD §2.3).
 *
 * @remarks
 * Captures a candidate include token iff the BOUNDARY rule holds: the `@` is at content
 * start OR preceded by a character that is NOT a path char (path chars = word chars plus
 * `.`, `/`, `-`). Group 1 is the bare path (without the leading `@`). The character class
 * `[\w./-]` mirrors the path-char set defined in PRD §2.3 / the include-tokenizer design.
 * `\w` is `[A-Za-z0-9_]`, so this rejects `foo@bar.com` (`o` before `@` is a path char) and
 * mid-word `@`, while accepting line-start, inline, and parenthesized tokens.
 */
const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;

/**
 * Options for {@link resolveIncludes}.
 */
export interface ResolveOpts {
  /**
   * Override the max-depth gate. Defaults to {@link getPrdIncludeMaxDepth}.
   *
   * @remarks
   * In S1 this is honored only as the base-case depth gate (a depth `< 1` returns the content
   * unchanged). The recursive depth-decrementing loop lands in S2.
   */
  maxDepth?: number;
  /**
   * When `true`, wrap each expanded include with `<!-- @include: path -->` /
   * `<!-- @end-include -->` markers (PRD §2.3). Defaults to
   * {@link getPrdIncludeMarkers} (the `PRD_INCLUDE_MARKERS` env var). Pass `false` explicitly
   * to suppress markers even when the env var is set.
   */
  markers?: boolean;
}

/**
 * Resolve `@path/to/file.md` include directives in a PRD string (PRD §2.3).
 *
 * @remarks
 * **SINGLE-LEVEL in S1**: each resolved token is replaced inline by its file's UTF-8 contents
 * verbatim; substituted content is NOT re-scanned (recursive expansion + cycle detection =
 * S2; markers + stale-include warnings = S3).
 *
 * A token expands iff BOTH hold:
 * 1. **BOUNDARY** — the `@` is at content start or preceded by a non-path char
 *    (path chars = `[A-Za-z0-9_./-]`); `foo@bar.com` and mid-word `@` stay literal.
 * 2. **EXISTENCE** — `resolve(baseDir, token)` is an existing **file**. Missing paths and
 *    directories stay verbatim and silent.
 *
 * Path resolution is project-root-relative: `resolve(baseDir, token)`, where `baseDir` is
 * the entry PRD's directory (passed in by the caller). When a token does not expand, the
 * ORIGINAL match bytes (`@token`) are preserved verbatim (idempotency-friendly for S3).
 *
 * @param content - Raw PRD string to scan for include directives.
 * @param baseDir - Directory to resolve include paths against (the entry PRD's directory).
 * @param opts - Optional {@link ResolveOpts} (currently only `maxDepth`).
 * @returns The content with single-level includes expanded inline.
 * @throws {SessionFileError} If an existing file cannot be read (e.g. invalid UTF-8) or a
 *         `stat` call fails with a non-ENOENT error (e.g. EACCES).
 *
 * @example
 * ```typescript
 * import { resolveIncludes } from './core/session-utils.js';
 *
 * // Given docs/a.md exists with body 'ARCH BODY':
 * await resolveIncludes('Top\n@docs/a.md\nBottom', '/proj');
 * // → 'Top\nARCH BODY\nBottom'
 * ```
 */
export async function resolveIncludes(
  content: string,
  baseDir: string,
  opts?: ResolveOpts
): Promise<string> {
  const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();
  if (maxDepth < 1) {
    return content; // depth gate (base case S2 recurses against)
  }

  const matches = [...content.matchAll(INCLUDE_TOKEN)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx); // gap before token (verbatim)
    const token = m[1];
    const abs = resolve(baseDir, token);
    let replacement: string | undefined;
    try {
      const st = await stat(abs);
      if (st.isFile()) {
        // Reuse the strict-UTF-8 reader: fatal decode + SessionFileError on failure.
        replacement = await readUTF8FileStrict(abs, 'read include');
      }
      // else: directory → not a file → replacement stays undefined (silent verbatim).
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        // missing → silent verbatim (S3 adds the .md-token stderr warning).
        replacement = undefined;
      } else {
        throw new SessionFileError(abs, 'stat include', e as Error);
      }
    }
    out += replacement ?? m[0]; // substitute OR keep original bytes
    last = idx + m[0].length;
  }
  out += content.slice(last); // tail
  return out;
}

// Mirrors S1's module-private INCLUDE_TOKEN (re-declared here because S1's const is not exported).
// The regex is a fixed one-line contract: group 1 = the bare path token (without the leading @).
const RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;

/**
 * Recursively expand `@token` include directives in `content` (PRD §2.3).
 *
 * @remarks
 * Internal worker for {@link resolvePRD}. Mirrors {@link resolveIncludes}'s scan loop + error
 * handling (stat/isFile/ENOENT/`SessionFileError`/`m[0]`-fallback) but adds two things:
 * 1. a `visited.has(abs)` **cycle check** — the back-edge `@token` is left literal (silent).
 * 2. **recursive descent** at `depth + 1` instead of a verbatim substitution.
 *
 * The `visited` set is PATH-BASED (per-branch ancestry): it is COPIED on each descent
 * (`new Set(visited).add(abs)`) so diamond includes (a→c and b→c) expand `c` in BOTH branches.
 * A flat/global set would wrongly deduplicate diamonds.
 *
 * `baseDir` is the ENTRY PRD's directory, passed UNCHANGED on every descent (never re-derived
 * from an included file's location) — this preserves the project-root-relative base invariant.
 *
 * The substitution site is a single `out += expanded ?? m[0];` line so S3 can wrap it with
 * `<!-- @include -->` markers later. S2 emits NO markers and NO stale-include warnings.
 *
 * @param content - Raw string to scan for include directives.
 * @param baseDir - Directory to resolve include paths against (the entry PRD's directory).
 * @param maxDepth - Max nesting depth (the gate is `depth >= maxDepth` → stop expanding).
 * @param depth - Current nesting depth (the entry file is depth 0).
 * @param visited - Absolute ancestry paths (path-based / per-branch) for cycle detection.
 * @param markers - When `true`, wrap each EXPANDED include in `<!-- @include: token -->` /
 *        `<!-- @end-include -->` markers (PRD §2.3). Literal survivors (missing/dir/cycle/depth)
 *        are never wrapped.
 * @returns The content with includes recursively expanded inline.
 * @throws {SessionFileError} If an existing included file cannot be read (e.g. invalid UTF-8)
 *         or a `stat` call fails with a non-ENOENT error (e.g. EACCES).
 */
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>,
  markers: boolean
): Promise<string> {
  if (depth >= maxDepth) {
    return content; // depth gate — remaining @tokens stay literal
  }

  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx); // gap before token (verbatim)
    const token = m[1];
    const abs = resolve(baseDir, token);

    if (visited.has(abs)) {
      out += m[0]; // CYCLE — leave back-edge literal, silent
      last = idx + m[0].length;
      continue;
    }

    let replacement: string | undefined;
    try {
      const st = await stat(abs);
      if (st.isFile()) {
        const child = await readUTF8FileStrict(abs, 'read include');
        // PATH-BASED ancestry: copy the set so sibling branches (diamonds) each get their own chain.
        const childVisited = new Set(visited).add(abs);
        replacement = await expandIncludesRecursive(
          child,
          baseDir,
          maxDepth,
          depth + 1,
          childVisited,
          markers
        );
      }
      // else: directory → not a file → replacement stays undefined (silent verbatim).
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        replacement = undefined; // missing → silent verbatim (S3 adds the .md-token stderr warning)
      } else {
        throw new SessionFileError(abs, 'stat include', e as Error);
      }
    }
    // S3: stale-include stderr warning — a `.md` token that matched the boundary rule but did
    //     NOT resolve to an existing file (ENOENT or a directory). Cycle back-edges `continue`d
    //     above; depth-exceeded tokens returned early at the gate. Non-`.md` survivors are silent.
    //     Routed through `console.warn` (→ process.stderr, sync) because the pino logger writes to
    //     stdout (PRD §2.3 requires stderr).
    if (replacement === undefined && token.endsWith('.md')) {
      console.warn(
        `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
      );
    }
    // S3: optional include markers around EXPANDED content only (PRD §2.3). Literal survivors
    //     (missing/dir/cycle/depth) are never wrapped — `markers && replacement !== undefined`.
    out +=
      markers && replacement !== undefined
        ? `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`
        : (replacement ?? m[0]);
    last = idx + m[0].length;
  }
  out += content.slice(last); // tail
  return out;
}

/**
 * Resolve a PRD entry file, recursively expanding `@path/to/file.md` includes (PRD §2.3).
 *
 * @remarks
 * Reads the entry PRD, then recursively expands include directives to their full depth:
 *  - **IDEMPOTENCY**: for any within-depth fixture, re-resolving this function's own output
 *    yields byte-identical results (`resolve(resolve(x)) === resolve(x)`). This is the basis
 *    for §4.1 hashing, §4.3 delta detection, and `prd_snapshot.md` consistency. Stale survivors
 *    (missing/dir) re-fail identically; depth-exceeded is an intentional safety-valve
 *    truncation that is NOT a fixed point.
 *  - **CYCLE DETECTION**: a path-based visited `Set` (absolute paths of the current ancestry)
 *    prevents infinite recursion on self/mutual cycles; the back-edge `@token` is left literal.
 *    Diamond includes (a→c and b→c) still expand `c` in both branches (the visited set is
 *    per-branch, not flat).
 *  - **MAX DEPTH**: expansion stops at {@link getPrdIncludeMaxDepth} (default 10) or the
 *    provided `opts.maxDepth`; deeper `@token`s stay literal. The entry file is depth 0, so
 *    `maxDepth = N` allows N nesting levels below the entry.
 *  - **BASE INVARIANT**: all paths resolve project-root-relative — against the entry PRD's
 *    directory, regardless of which file contains the directive (PRD §2.3).
 *  - **MARKERS (optional)**: when `opts.markers` is `true` OR the `PRD_INCLUDE_MARKERS` env var
 *    is truthy (unset/empty/`0`/`false`/`no`/`off` → off), each EXPANDED include is wrapped as
 *    `<!-- @include: path -->` / `<!-- @end-include -->` (where `path` is the original matched
 *    token). Literal survivors (missing/dir/cycle/depth) are never wrapped. `opts.markers`
 *    overrides the env var in both directions. The marker format is self-protecting against
 *    re-expansion, so markers-on output remains idempotent (PRD §2.3).
 *  - **STALE-INCLUDE WARNING**: a `.md` token that matches the boundary rule but does NOT resolve
 *    to an existing file (ENOENT or a directory) emits exactly one **stderr** warning per resolve
 *    pass via `console.warn` (the pino logger writes to stdout; PRD §2.3 requires stderr). The
 *    token stays verbatim in the output. Non-`.md` tokens, cycle back-edges, depth-exceeded
 *    tokens, and successfully-resolved tokens emit NO warning (PRD §2.3).
 *
 * Missing files, directories, and cycle back-edges stay verbatim.
 *
 * @param prdPath - Path to the entry PRD file (relative or absolute).
 * @param opts - Optional {@link ResolveOpts} (`maxDepth`, `markers`).
 * @returns The fully include-expanded document.
 * @throws {SessionFileError} If the entry file (or any included file) cannot be read / is
 *         invalid UTF-8, or a `stat` fails with a non-ENOENT error.
 *
 * @example
 * ```typescript
 * import { resolvePRD } from './core/session-utils.js';
 *
 * // Given docs/a.md which itself contains '@docs/b.md', both expand inline recursively:
 * const resolved = await resolvePRD('/path/to/PRD.md');
 * ```
 */
export async function resolvePRD(
  prdPath: string,
  opts?: ResolveOpts
): Promise<string> {
  const absEntry = resolve(prdPath);
  const baseDir = dirname(absEntry); // project-root-relative base invariant (PRD §2.3)
  const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();
  const markers = opts?.markers ?? getPrdIncludeMarkers(); // S3: marker toggle (opts wins over env)

  logger().debug(
    { prdPath: absEntry, baseDir, maxDepth, markers },
    'Resolving PRD includes'
  );

  const entryContent = await readUTF8FileStrict(absEntry, 'read PRD');
  // Seed visited with the entry so an include pointing back at the entry is a cycle.
  return expandIncludesRecursive(
    entryContent,
    baseDir,
    maxDepth,
    0,
    new Set<string>([absEntry]),
    markers
  );
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
 * @param precomputedHash - Optional full (64-char) PRD hash. When supplied, skips the internal
 *        `hashPRD` call (and thus a second resolution). Used by callers that already resolved +
 *        hashed the PRD (e.g. {@link SessionManager.initialize}, which resolves once). When
 *        omitted, the hash is recomputed via {@link hashPRD} (which resolves).
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
  planDir: string = resolve('plan'),
  precomputedHash?: string
): Promise<string> {
  // PRD §4.6 guard rail (e): mkdir -p PLAN_DIR FIRST so the session path is
  // always nested under it, and reject an empty planDir so collapsed root
  // paths can never be written. EEXIST is tolerated (the plan dir already
  // existing is the normal case for any project beyond the first session).
  if (!planDir || planDir.trim() === '') {
    throw new Error('planDir cannot be empty (PRD §4.6)');
  }
  try {
    await mkdir(planDir, { recursive: true, mode: 0o755 });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EEXIST') {
      throw new SessionFileError(planDir, 'mkdir plan dir', error as Error);
    }
  }

  try {
    // Compute PRD hash. When a precomputed hash is supplied, use it directly (the
    // caller — e.g. SessionManager.initialize — already resolved + hashed, so this
    // avoids a second resolution). Otherwise recompute via hashPRD (which resolves).
    // Written as an explicit if/else rather than `??`/`?:` with an awaited operand:
    // v8's coverage instrumentation mis-attributes statements following
    // `x ?? (await f())` / `x ? x : await f()`.
    let fullHash: string;
    if (precomputedHash) {
      fullHash = precomputedHash;
    } else {
      fullHash = await hashPRD(prdPath);
    }
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
    // PRD §5.1 / bugfix Issue 3B: lenient READ twin — accepts legacy / hand-edited /
    // externally-authored sessions whose context_scope lacks the CONTRACT DEFINITION
    // prefix (the strict write gate stays at writeTasksJSON:777). Leniency is FORMAT-only;
    // structural errors (bad ID/status/empty scope) still throw SessionFileError.
    const validated = BacklogReadSchema.parse(parsed);

    // Observable lenient acceptance (no rejection): scan the validated backlog for
    // subtasks whose context_scope lacks the CONTRACT DEFINITION prefix and emit a
    // single debug-level breadcrumb listing the IDs (PRD Issue 3 "warn on read").
    const nonContractIds: string[] = [];
    for (const phase of validated.backlog) {
      for (const milestone of phase.milestones) {
        for (const task of milestone.tasks) {
          for (const subtask of task.subtasks) {
            if (!subtask.context_scope.startsWith('CONTRACT DEFINITION:')) {
              nonContractIds.push(subtask.id);
            }
          }
        }
      }
    }
    if (nonContractIds.length > 0) {
      logger().debug(
        { sessionPath, nonContractIds, count: nonContractIds.length },
        'tasks.json loaded with subtask(s) missing CONTRACT DEFINITION prefix (lenient read)'
      );
    }

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
 * Writes the PRD content to `prd_snapshot.md` in the session directory. When `resolvedContent`
 * is supplied it is written directly (used by {@link SessionManager.initialize}, which resolves
 * once and feeds the SAME resolved string to both the hash and the snapshot). When omitted, the
 * entry file is resolved via {@link resolvePRD} (expanding `@`-includes, PRD §2.3) before writing.
 *
 * This snapshot preserves a frozen copy of the FULLY-RESOLVED PRD for reference during
 * implementation. It is created with mode 0o644 (owner read/write, group/others read-only).
 *
 * @param sessionPath - Path to session directory
 * @param prdPath - Path to PRD markdown file
 * @param resolvedContent - Optional pre-resolved PRD document to write directly. When supplied,
 *        skips re-resolution. When omitted, the entry file is resolved via {@link resolvePRD}.
 * @throws {SessionFileError} If PRD cannot be read/resolved, has invalid UTF-8, or snapshot cannot be written
 *
 * @example
 * ```typescript
 * await snapshotPRD('/path/to/session', '/path/to/PRD.md');
 * // Creates: /path/to/session/prd_snapshot.md
 * ```
 */
export async function snapshotPRD(
  sessionPath: string,
  prdPath: string,
  resolvedContent?: string
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

    // Resolve the PRD (expand @-includes) unless pre-resolved content was supplied (PRD §2.3).
    // Written as an explicit if/else rather than `??`/`?:` with an awaited operand:
    // v8's coverage instrumentation mis-attributes statements following
    // `x ?? (await f())` / `x ? x : await f()`.
    let content: string;
    if (resolvedContent) {
      content = resolvedContent;
    } else {
      content = await resolvePRD(absPRDPath);
    }

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

// ============================================================================
// PRD-change pending-delta marker (PRD §4.3 "The Delta Workflow")
// ============================================================================

/**
 * The PRD-change pending-delta marker filename.
 *
 * @remarks
 * A plain file written into the session directory when a PRD change is detected
 * on an active session (PRD §4.3 "Detection"). The file's CONTENT is the pending
 * (new) PRD hash — i.e. the `.pending_delta_hash` named in PRD §4.3 step 2.
 *
 * Why a file (and not a `SessionState` field)? Adding a field to the readonly
 * {@link SessionState} interface means editing the interface, its Zod schema,
 * `loadSession()` reconstruction, `createSessionDirectory()`, and every place
 * that constructs a `SessionState` — a large blast radius. A marker file is
 * lighter, survives across runs, is grep-able, and mirrors how
 * `parent_session.txt` already persists session-level linkage.
 *
 * Consumed by:
 *  - {@link acceptPrdChangesResponse}-style handling: `--accept-prd-changes`
 *    cancels the marker, refreshes `prd_snapshot.md`, and exits idempotently
 *    (PRD §4.3 step 2).
 *  - the integrate-into-current path: the marker is cleared only AFTER
 *    integration has applied (the snapshot is preserved until then).
 *  - P4.M1.T2.S2 (validate/bug-hunt reuse) reads it via
 *    {@link readPendingDeltaHash} to detect a pending change on a completed
 *    session.
 */
export const PENDING_DELTA_HASH_FILE = 'prd_changed.marker';

/**
 * Write the pending-delta marker (`.pending_delta_hash`) to a session directory.
 *
 * @remarks
 * Mode B (additive helper). Written when a PRD change is detected on an active
 * session (PRD §4.3 "Detection"). The marker contains the new (pending) PRD
 * hash so downstream handlers (accept / integrate / reuse) know which baseline
 * the change points at.
 *
 * @param sessionPath - Absolute session directory path.
 * @param hash - The new (pending) PRD hash (e.g. the first 12 chars of
 *        {@link hashPRDContent}).
 * @throws {SessionFileError} If the marker file cannot be written.
 */
export async function writePendingDeltaHash(
  sessionPath: string,
  hash: string
): Promise<void> {
  const markerPath = resolve(sessionPath, PENDING_DELTA_HASH_FILE);
  try {
    await writeFile(markerPath, hash, { mode: 0o644 });
  } catch (error) {
    if (error instanceof SessionFileError) {
      throw error;
    }
    throw new SessionFileError(
      markerPath,
      'write pending-delta marker',
      error as Error
    );
  }
}

/**
 * Read the pending-delta marker (`.pending_delta_hash`) from a session directory.
 *
 * @remarks
 * Mode B (additive helper). Returns the pending PRD hash string, or `null` when
 * there is no pending change (ENOENT). Callers must treat `null` as "no PRD
 * change pending" (PRD §4.3).
 *
 * @param sessionPath - Absolute session directory path.
 * @returns The pending PRD hash, trimmed; or `null` if no marker exists.
 */
export async function readPendingDeltaHash(
  sessionPath: string
): Promise<string | null> {
  try {
    return (
      await readFile(resolve(sessionPath, PENDING_DELTA_HASH_FILE), 'utf-8')
    ).trim();
  } catch {
    // ENOENT (or any read failure) → no pending change.
    return null;
  }
}

/**
 * Clear the pending-delta marker (`.pending_delta_hash`) from a session directory.
 *
 * @remarks
 * Mode B (additive helper). Called by `--accept-prd-changes` (PRD §4.3 step 2:
 * "across all `PRD_CHANGED_*` session states it cancels any queued
 * `.pending_delta_hash`") and by the integrate-into-current path AFTER
 * integration has applied. Missing-file (ENOENT) is silently ignored so the
 * operation is idempotent.
 *
 * @param sessionPath - Absolute session directory path.
 */
export async function clearPendingDeltaHash(
  sessionPath: string
): Promise<void> {
  try {
    await unlink(resolve(sessionPath, PENDING_DELTA_HASH_FILE));
  } catch {
    // ENOENT is fine — nothing to clear (idempotent).
  }
}

/**
 * Refresh `prd_snapshot.md` to the CURRENT (resolved) PRD.
 *
 * @remarks
 * Mode B (additive helper). The counterpart of {@link snapshotPRD} for the
 * "accept PRD edits as new baseline" case. Used by:
 *  - `--accept-prd-changes` — accept PRD edits as the new baseline without
 *    generating a delta session (PRD §4.3 step 2).
 *  - integrate-into-current — called ONLY AFTER integration has applied the
 *    patch (PRD §4.3: "the snapshot is refreshed only once integration has
 *    applied"). Refreshing early erases the diff the integration agent needs.
 *
 * The snapshot is written with the same `mode: 0o644` style as
 * {@link snapshotPRD}.
 *
 * @param sessionPath - Absolute session directory path.
 * @param prdPath - Path to the current PRD (resolved via {@link resolvePRD}).
 * @throws {SessionFileError} If the PRD cannot be resolved or the snapshot
 *         cannot be written.
 */
export async function refreshSnapshotToCurrentPRD(
  sessionPath: string,
  prdPath: string
): Promise<void> {
  const snapshotPath = resolve(sessionPath, 'prd_snapshot.md');
  try {
    const resolved = await resolvePRD(prdPath);
    await writeFile(snapshotPath, resolved, { mode: 0o644 });
  } catch (error) {
    if (error instanceof SessionFileError) {
      throw error;
    }
    throw new SessionFileError(
      snapshotPath,
      'refresh PRD snapshot to current PRD',
      error as Error
    );
  }
}

/**
 * Render a focused delta-PRD markdown from a structured {@link DeltaAnalysis}.
 *
 * @remarks
 * PRD §4.3 step 5 ("Delta PRD Generation"): the delta PRD focuses ONLY on
 * differences (added/modified/removed) plus preserved completed work. This is a
 * DETERMINISTIC render of the semantic diff that
 * {@link DeltaAnalysisWorkflow.analyzeDelta} already produced (retried via
 * `retryAgentPrompt`, `maxAttempts: 3`) — there is NO second LLM call. The
 * retry/fail-fast contract (PRD §4.3 "retry then fail fast") is inherited from
 * that upstream retried step: if the LLM exhausts retries, `spawnDeltaSession`
 * throws before this render runs.
 *
 * The output is the breakdown input for delta sessions (consumed by
 * `decomposePRD` via {@link loadDeltaPRD}). It is NOT the full PRD — it carries
 * only Added/Modified/Removed sections, a completed-work-preserved list, patch
 * instructions, and tasks to re-execute.
 *
 * Pure: no I/O, no imports beyond the `DeltaAnalysis` type.
 *
 * @param delta - The structured delta analysis (changes + patch instructions +
 *        task IDs to re-execute).
 * @param completedTaskIds - Parent-session task IDs that are already complete
 *        (preserved — not to be re-implemented).
 * @param parentSessionId - The parent session id (referenced in the header).
 * @returns Focused delta-PRD markdown string.
 */
export function renderDeltaPRD(
  delta: DeltaAnalysis,
  completedTaskIds: string[],
  parentSessionId: string
): string {
  const added = delta.changes.filter(c => c.type === 'added');
  const modified = delta.changes.filter(c => c.type === 'modified');
  const removed = delta.changes.filter(c => c.type === 'removed');
  const lines: string[] = [];
  lines.push('# Delta PRD');
  lines.push('');
  lines.push(
    `> Focused on differences vs parent session \`${parentSessionId}\`.`
  );
  lines.push(
    '> This is NOT the full PRD — only added/modified/removed requirements.'
  );
  lines.push('');
  if (completedTaskIds.length > 0) {
    lines.push('## Completed Work (preserved — do NOT re-implement)');
    for (const id of completedTaskIds) lines.push(`- ${id}`);
    lines.push('');
  }
  const section = (title: string, items: typeof added): void => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const c of items) {
      lines.push(`### ${c.itemId}`);
      lines.push(`- **What changed:** ${c.description}`);
      lines.push(`- **Impact:** ${c.impact}`);
      lines.push('');
    }
  };
  section('Added', added);
  section('Modified', modified);
  if (removed.length > 0) {
    lines.push('## Removed (for awareness — no implementation tasks)');
    for (const c of removed) lines.push(`- **${c.itemId}:** ${c.description}`);
    lines.push('');
  }
  lines.push('## Patch Instructions');
  lines.push(delta.patchInstructions);
  lines.push('');
  if (delta.taskIds.length > 0) {
    lines.push('## Tasks to Re-execute');
    for (const id of delta.taskIds) lines.push(`- ${id}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Write `delta_prd.md` to a session directory (atomic).
 *
 * @remarks
 * PRD §4.3 step 5 ("Delta PRD Generation"): generates the focused delta PRD
 * artifact for a delta session. Uses {@link atomicWrite} (temp file + rename)
 * for crash-safety, mirroring {@link writePRP}. The input is already-built
 * markdown (from {@link renderDeltaPRD}) — no Zod validation is applied.
 *
 * @param sessionPath - Absolute session directory path.
 * @param content - The delta-PRD markdown to write.
 * @throws {SessionFileError} If the atomic write fails (disk/permissions).
 */
export async function writeDeltaPRD(
  sessionPath: string,
  content: string
): Promise<void> {
  const deltaPrdPath = resolve(sessionPath, 'delta_prd.md');
  try {
    await atomicWrite(deltaPrdPath, content);
  } catch (error) {
    if (error instanceof SessionFileError) throw error;
    throw new SessionFileError(deltaPrdPath, 'write delta PRD', error as Error);
  }
}

/**
 * Read `delta_prd.md` from a session directory.
 *
 * @remarks
 * PRD §4.3 step 5 ("Breakdown MUST consume the delta PRD"): the delta
 * breakdown runs over `delta_prd.md`, NOT the full PRD. This loader is the
 * source for `decomposePRD` on a delta session. Mirrors {@link loadSnapshot}
 * but reads `delta_prd.md` instead of `prd_snapshot.md`.
 *
 * Throws {@link SessionFileError} on ENOENT — `decomposePRD`'s delta branch
 * uses this as the missing-file detector (PRD §4.3: incomplete delta sessions
 * must NOT silently fall back to the full PRD).
 *
 * @param sessionPath - Absolute session directory path.
 * @returns Promise resolving to the delta-PRD markdown content.
 * @throws {SessionFileError} If the file is missing or has invalid UTF-8.
 */
export async function loadDeltaPRD(sessionPath: string): Promise<string> {
  return readUTF8FileStrict(
    resolve(sessionPath, 'delta_prd.md'),
    'read delta PRD'
  );
}
