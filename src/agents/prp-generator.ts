/**
 * PRP Generator for automated Product Requirement Prompt creation
 *
 * @module agents/prp-generator
 *
 * @remarks
 * Orchestrates the Researcher Agent to generate comprehensive PRPs
 * for any Task or Subtask in the backlog. Handles retry logic, file
 * persistence, and error recovery.
 */

// CRITICAL: Import patterns - use .js extensions for ES modules
import { createResearcherAgent } from './agent-factory.js';
import { createPRPBlueprintPrompt } from './prompts/prp-blueprint-prompt.js';
import { getLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import type { Agent } from 'groundswell';
import type {
  PRPDocument,
  Task,
  Subtask,
  Backlog,
  PRPCompressionLevel,
} from '../core/models.js';
import { PRPDocumentSchema } from '../core/models.js';
import type { SessionManager } from '../core/session-manager.js';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { retryAgentPrompt } from '../utils/retry.js';
import { TokenCounter, PERSONA_TOKEN_LIMITS } from '../utils/token-counter.js';
import { CodeProcessor } from '../utils/code-processor.js';

/**
 * Custom error for PRP generation failures
 *
 * @remarks
 * Thrown when the Researcher Agent fails to generate a PRP after
 * all retry attempts are exhausted. Includes task ID and attempt
 * count for debugging and monitoring.
 */
export class PRPGenerationError extends Error {
  /**
   * Creates a new PRPGenerationError
   *
   * @param taskId - The work item ID that failed
   * @param attempt - The attempt number that failed (1-indexed)
   * @param originalError - The underlying error that caused the failure
   */
  constructor(
    public readonly taskId: string,
    public readonly attempt: number,
    originalError: unknown
  ) {
    super(
      `Failed to generate PRP for ${taskId} after ${attempt} attempts: ${
        originalError instanceof Error
          ? originalError.message
          : String(originalError)
      }`
    );
    this.name = 'PRPGenerationError';
  }
}

/**
 * Custom error for PRP file write failures
 *
 * @remarks
 * Thrown when the generated PRP cannot be written to disk. Includes
 * task ID and file path for debugging and recovery.
 */
export class PRPFileError extends Error {
  /**
   * Creates a new PRPFileError
   *
   * @param taskId - The work item ID whose PRP failed to write
   * @param filePath - The file path that could not be written
   * @param originalError - The underlying error that caused the failure
   */
  constructor(
    public readonly taskId: string,
    public readonly filePath: string,
    originalError: unknown
  ) {
    super(
      `Failed to write PRP file for ${taskId} to ${filePath}: ${
        originalError instanceof Error
          ? originalError.message
          : String(originalError)
      }`
    );
    this.name = 'PRPFileError';
  }
}

/**
 * Cache metadata for PRP storage
 *
 * @remarks
 * Stored alongside PRP markdown files in prps/.cache/ directory.
 * Tracks task hash for change detection and timestamps for TTL expiration.
 *
 * Compression fields are optional for backward compatibility with existing cache entries.
 */
export interface PRPCacheMetadata {
  readonly taskId: string;
  readonly taskHash: string;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly version: string;
  readonly prp: PRPDocument;

  // NEW: Compression metrics (all optional for backward compatibility)
  readonly compressionLevel?: PRPCompressionLevel;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly compressionRatio?: number; // (originalSize / compressedSize)
  readonly originalSize?: number; // Character count before compression
  readonly compressedSize?: number; // Character count after compression
}

/**
 * PRP Generator for automated Product Requirement Prompt creation
 *
 * @remarks
 * Orchestrates the Researcher Agent to generate comprehensive PRPs
 * for any Task or Subtask in the backlog. Handles retry logic, file
 * persistence, and error recovery.
 *
 * Usage flow:
 * 1. Instantiate with SessionManager
 * 2. Call generate() with task/subtask and backlog
 * 3. PRP is generated, validated, and written to disk
 * 4. Returns PRPDocument for downstream use
 *
 * @example
 * ```typescript
 * import { PRPGenerator } from './agents/prp-generator.js';
 *
 * const generator = new PRPGenerator(sessionManager);
 * const prp = await generator.generate(subtask, backlog);
 * // PRP file written to: {sessionPath}/prps/P1M2T2S2.md
 * ```
 */
export class PRPGenerator {
  /** Logger instance for structured logging */
  readonly #logger: Logger;

  /** Session manager for accessing session state and paths */
  readonly sessionManager: SessionManager;

  /** Path to session directory (extracted for convenience) */
  readonly sessionPath: string;

  /** Cached Researcher Agent instance */
  #researcherAgent: Agent;

  /** Cache bypass flag from CLI --no-cache */
  readonly #noCache: boolean;

  /** Cache hit counter for metrics */
  #cacheHits: number = 0;

  /** Cache miss counter for metrics */
  #cacheMisses: number = 0;

  /** Cache TTL in milliseconds (configurable, default 24 hours) */
  readonly #cacheTtlMs: number;

  /** PRP compression level */
  readonly #compression: PRPCompressionLevel;

  /** Token counter for measuring token usage */
  readonly #tokenCounter: TokenCounter;

  /** Code processor for compressing code snippets */
  readonly #codeProcessor: CodeProcessor;

  /**
   * Creates a new PRPGenerator instance
   *
   * @param sessionManager - Session state manager
   * @param noCache - Whether to bypass cache (default: false)
   * @param cacheTtlMs - Cache TTL in milliseconds (default: 24 hours)
   * @param prpCompression - PRP compression level (default: 'standard')
   * @throws {Error} If no session is currently loaded
   *
   * @example
   * ```typescript
   * const generator = new PRPGenerator(sessionManager, false);
   * ```
   */
  constructor(
    sessionManager: SessionManager,
    noCache: boolean = false,
    cacheTtlMs: number = 24 * 60 * 60 * 1000,
    prpCompression: PRPCompressionLevel = 'standard'
  ) {
    this.#logger = getLogger('PRPGenerator');
    this.sessionManager = sessionManager;
    this.#noCache = noCache;
    this.#cacheTtlMs = cacheTtlMs;
    this.#compression = prpCompression;
    this.#tokenCounter = new TokenCounter();
    this.#codeProcessor = new CodeProcessor();

    // Extract session path from current session
    const currentSession = sessionManager.currentSession;
    if (!currentSession) {
      throw new Error('Cannot create PRPGenerator: no active session');
    }
    this.sessionPath = currentSession.metadata.path;

    // Cache Researcher Agent for reuse
    this.#researcherAgent = createResearcherAgent();
  }

  /**
   * Gets the file path for a cached PRP markdown file
   *
   * @param taskId - The task ID (e.g., "P1.M1.T1.S1")
   * @returns Absolute path to PRP markdown file
   *
   * @remarks
   * Sanitizes taskId by replacing dots with underscores for filename.
   * Matches the format used by #writePRPToFile().
   */
  getCachePath(taskId: string): string {
    const sanitized = taskId.replace(/\./g, '_');
    return join(this.sessionPath, 'prps', `${sanitized}.md`);
  }

  /**
   * Gets the file path for cache metadata JSON
   *
   * @param taskId - The task ID (e.g., "P1.M1.T1.S1")
   * @returns Absolute path to cache metadata JSON file
   *
   * @remarks
   * Cache metadata is stored in prps/.cache/ subdirectory.
   * Contains task hash, timestamps, and full PRPDocument for easy retrieval.
   */
  getCacheMetadataPath(taskId: string): string {
    const sanitized = taskId.replace(/\./g, '_');
    return join(this.sessionPath, 'prps', '.cache', `${sanitized}.json`);
  }

  /**
   * Computes SHA-256 hash of task inputs for change detection
   *
   * @param task - The Task or Subtask to hash
   * @param backlog - The full Backlog (not used in hash, only Task inputs)
   * @returns Hexadecimal SHA-256 hash string
   *
   * @remarks
   * Includes only fields that affect PRP output.
   * For Task: id, title, description
   * For Subtask: id, title, context_scope
   * Excludes fields that don't affect PRP content: status, dependencies, story_points.
   * Uses deterministic JSON serialization (no whitespace) for consistent hashing.
   */
  #computeTaskHash(task: Task | Subtask, _backlog: Backlog): string {
    // Build input object based on type
    let input: Record<string, unknown>;

    if (task.type === 'Task') {
      // Task has: id, title, description
      input = {
        id: task.id,
        title: task.title,
        description: (task as Task).description,
      };
    } else {
      // Subtask has: id, title, context_scope
      input = {
        id: task.id,
        title: task.title,
        context_scope: (task as Subtask).context_scope,
      };
    }

    // Deterministic JSON serialization (no whitespace)
    const jsonString = JSON.stringify(input, null, 0);

    // SHA-256 hash for collision resistance
    return createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Checks if a cache file is recent enough to use
   *
   * @param filePath - Path to the cache file
   * @returns true if file exists and is younger than TTL, false otherwise
   *
   * @remarks
   * Uses file modification time (mtime) to determine age.
   * Returns false for ENOENT (file doesn't exist) or any other error.
   * TTL is configurable via constructor parameter (default: 24 hours).
   */
  async #isCacheRecent(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      const age = Date.now() - stats.mtimeMs;
      return age < this.#cacheTtlMs;
    } catch {
      // File doesn't exist or can't be read
      return false;
    }
  }

  /**
   * Loads a cached PRP from disk
   *
   * @param taskId - The task ID to load from cache
   * @returns Cached PRPDocument, or null if not found/invalid
   *
   * @remarks
   * Reads cache metadata JSON and validates the PRPDocument.
   * Returns null for any error (missing file, invalid JSON, schema validation failure).
   */
  async #loadCachedPRP(taskId: string): Promise<PRPDocument | null> {
    try {
      const metadataPath = this.getCacheMetadataPath(taskId);
      const metadataContent = await readFile(metadataPath, 'utf-8');
      const metadata: PRPCacheMetadata = JSON.parse(metadataContent);

      // Validate against schema
      return PRPDocumentSchema.parse(metadata.prp);
    } catch {
      return null;
    }
  }

  /**
   * Saves cache metadata after PRP generation
   *
   * @param taskId - The task ID
   * @param taskHash - Hash of task inputs for change detection
   * @param prp - The generated PRPDocument
   * @param inputTokens - Original token count before compression (optional)
   * @param outputTokens - Token count after compression (optional)
   * @throws {Error} If directory creation or file write fails
   *
   * @remarks
   * Creates .cache directory if it doesn't exist.
   * Stores full PRPDocument in metadata for easy retrieval.
   * Updates accessedAt timestamp for cache age tracking.
   * Stores compression metrics for monitoring.
   */
  async #saveCacheMetadata(
    taskId: string,
    taskHash: string,
    prp: PRPDocument,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<void> {
    const metadataPath = this.getCacheMetadataPath(taskId);
    const cacheDir = dirname(metadataPath);

    // Create .cache directory if missing
    await mkdir(cacheDir, { recursive: true });

    const now = Date.now();

    // Calculate compression metrics if tokens provided
    const compressionMetrics =
      inputTokens !== undefined && outputTokens !== undefined
        ? {
            compressionLevel: this.#compression,
            inputTokens,
            outputTokens,
            compressionRatio: inputTokens / outputTokens,
            originalSize: prp.context.length,
            compressedSize: prp.context.length,
          }
        : undefined;

    const metadata: PRPCacheMetadata = {
      taskId,
      taskHash,
      createdAt: now,
      accessedAt: now,
      version: '1.0',
      prp,
      ...compressionMetrics,
    };

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), {
      mode: 0o644,
    });
  }

  /**
   * Loads cache metadata for hash verification
   *
   * @param taskId - The task ID
   * @returns Cache metadata, or null if not found/invalid
   *
   * @remarks
   * Separate from #loadCachedPRP() to allow hash checking before
   * loading the full PRPDocument.
   */
  async #loadCacheMetadata(taskId: string): Promise<PRPCacheMetadata | null> {
    try {
      const metadataPath = this.getCacheMetadataPath(taskId);
      const metadataContent = await readFile(metadataPath, 'utf-8');
      return JSON.parse(metadataContent) as PRPCacheMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Logs cache metrics for monitoring
   *
   * @remarks
   * Logs hits, misses, and hit ratio percentage.
   * Follows TaskOrchestrator pattern from task-orchestrator.ts.
   */
  #logCacheMetrics(): void {
    const total = this.#cacheHits + this.#cacheMisses;
    const hitRatio = total > 0 ? (this.#cacheHits / total) * 100 : 0;

    this.#logger.info(
      {
        hits: this.#cacheHits,
        misses: this.#cacheMisses,
        hitRatio: hitRatio.toFixed(1),
      },
      'PRP cache metrics'
    );
  }

  /**
   * Compresses PRP content based on compression level
   *
   * @param prp - The PRP document to compress
   * @returns Object with compressed PRP and token counts
   *
   * @remarks
   * Applies compression strategies based on the configured level:
   * - 'off': No compression
   * - 'standard': Code snippet compression, large file references
   * - 'aggressive': All standard + parent context truncation
   */
  #compressPRP(prp: PRPDocument): {
    compressed: PRPDocument;
    originalTokens: number;
    compressedTokens: number;
  } {
    if (this.#compression === 'off') {
      const tokens = this.#tokenCounter.countTokens(prp.context);
      return {
        compressed: prp,
        originalTokens: tokens,
        compressedTokens: tokens,
      };
    }

    const compressed = { ...prp };
    const originalTokens = this.#tokenCounter.countTokens(prp.context);

    // Compress code snippets in context
    compressed.context = this.#compressCodeSnippets(compressed.context);

    // Replace large file references (>500 chars)
    compressed.context = this.#replaceLargeReferences(compressed.context);

    // Aggressive mode: truncate parent context
    if (this.#compression === 'aggressive') {
      compressed.context = this.#truncateParentContext(compressed.context);
    }

    const compressedTokens = this.#tokenCounter.countTokens(compressed.context);

    // Warn if approaching token limit
    const tokenLimit = PERSONA_TOKEN_LIMITS.researcher;
    if (compressedTokens > tokenLimit * 0.8) {
      this.#logger.warn(
        {
          taskId: prp.taskId,
          tokens: compressedTokens,
          limit: tokenLimit,
          percentage: ((compressedTokens / tokenLimit) * 100).toFixed(1),
        },
        'PRP approaching token limit'
      );
    }

    return { compressed, originalTokens, compressedTokens };
  }

  /**
   * Compresses code snippets in PRP context
   *
   * @param context - The context string to compress
   * @returns Context with compressed code snippets
   *
   * @remarks
   * Finds all code blocks and compresses them using CodeProcessor.
   * Preserves language identifiers and code structure.
   */
  #compressCodeSnippets(context: string): string {
    return context.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const compressed = this.#codeProcessor.removeComments(code);
      const noBlanks = this.#codeProcessor.removeBlankLines(compressed);
      return `\`\`\`${lang || ''}\n${noBlanks}\n\`\`\``;
    });
  }

  /**
   * Replaces large file content with references
   *
   * @param context - The context string to process
   * @returns Context with large files replaced by references
   *
   * @remarks
   * Finds file content blocks >500 characters and replaces them
   * with references like "See src/path/file.ts lines 1-50".
   */
  #replaceLargeReferences(context: string): string {
    return context.replace(
      /```(?:file|path):\s*(\S+?)\n([\s\S]{500,}?)```/g,
      (_, filePath, content) => {
        const lines = content.split('\n');
        return `See ${filePath} lines 1-${lines.length}`;
      }
    );
  }

  /**
   * Truncates parent context to 2 levels, 100 chars each
   *
   * @param context - The context string to truncate
   * @returns Context with truncated parent context
   *
   * @remarks
   * Finds parent context section and truncates each level to 100 characters.
   * Used in aggressive mode to further reduce token usage.
   */
  #truncateParentContext(context: string): string {
    // Find Parent Context section
    const parentContextMatch = context.match(
      /## Parent Context\s*\n([\s\S]*?)(?=\n##|$)/
    );
    if (!parentContextMatch) {
      return context;
    }

    const parentContext = parentContextMatch[1];
    const lines = parentContext.split('\n');
    const truncatedLines = lines
      .map(line => line.slice(0, 100))
      .filter(l => l.length > 0);

    return context.replace(parentContextMatch[0], truncatedLines.join('\n'));
  }

  /**
   * Generates a PRP for the given task or subtask
   *
   * @remarks
   * Executes the Researcher Agent with retry logic and exponential backoff.
   * The generated PRP is validated against the schema and written to disk.
   *
   * Retry configuration:
   * - Max retries: 3
   * - Base delay: 1000ms (1 second)
   * - Max delay: 30000ms (30 seconds)
   * - Exponential backoff: 2^n
   *
   * @param task - The Task or Subtask to generate a PRP for
   * @param backlog - The full Backlog for context extraction
   * @param issueFeedback - Optional feedback string for re-planning (PRD §4.5). When provided and non-empty,
   *   the feedback is injected into the prompt via a `<issue_feedback>…</issue_feedback>` block and the
   *   cache READ is bypassed so the Researcher always re-researches with the feedback. Cache WRITE remains
   *   unchanged (the feedback-aware PRP is cached for reuse). When omitted, behavior is identical to today.
   * @returns Generated PRPDocument with all PRP content
   * @throws {PRPGenerationError} If generation fails after all retries
   * @throws {PRPFileError} If PRP file cannot be written
   *
   * @example
   * ```typescript
   * const subtask = findItem(backlog, 'P1.M2.T2.S2') as Subtask;
   * const prp = await generator.generate(subtask, backlog);
   * console.log(prp.objective); // Feature goal from PRP
   * ```
   */
  async generate(
    task: Task | Subtask,
    backlog: Backlog,
    issueFeedback?: string
  ): Promise<PRPDocument> {
    // Cache checking: Check disk cache before LLM call
    // Bypass cache READ when issueFeedback is present — #computeTaskHash does NOT include feedback,
    // so a re-research would serve the stale (insufficient) cached PRP. Belt-and-suspenders with S4's PRP deletion.
    if (!this.#noCache && !issueFeedback) {
      const cachePath = this.getCachePath(task.id);
      const currentHash = this.#computeTaskHash(task, backlog);

      // Check if cached PRP exists and is recent
      if (await this.#isCacheRecent(cachePath)) {
        const cachedPRP = await this.#loadCachedPRP(task.id);

        // Verify hash matches (task hasn't changed)
        if (cachedPRP) {
          const cachedMetadata = await this.#loadCacheMetadata(task.id);
          if (cachedMetadata?.taskHash === currentHash) {
            // CACHE HIT
            this.#cacheHits++;
            this.#logger.info({ taskId: task.id }, 'PRP cache HIT');
            this.#logCacheMetrics();
            return cachedPRP;
          }
        }
      }

      // CACHE MISS (hash mismatch or file expired)
      this.#cacheMisses++;
      this.#logger.debug({ taskId: task.id }, 'PRP cache MISS');
    } else if (!this.#noCache && issueFeedback) {
      this.#logger.debug(
        { taskId: task.id },
        'PRP cache READ bypassed for feedback re-research'
      );
    } else {
      this.#logger.debug('Cache bypassed via --no-cache flag');
    }

    // Compute the PRP output path BEFORE building the prompt so we can tell
    // the researcher exactly where to write. Filename mirrors what
    // #writePRPToFile / PRPRuntime expect: {sanitizedId}.md (we write JSON
    // content into it — the coder agent reads it as-is via prpPath).
    const sanitizedId = task.id.replace(/\./g, '_');
    const prpOutputPath = join(this.sessionPath, 'prps', `${sanitizedId}.json`);
    await mkdir(join(this.sessionPath, 'prps'), { recursive: true });

    // Step 1: Build prompt with task context (pass issueFeedback for re-planning)
    const prompt = createPRPBlueprintPrompt(
      task,
      backlog,
      process.cwd(),
      prpOutputPath,
      issueFeedback
    );

    // Step 2: Execute Researcher Agent with centralized retry logic
    this.#logger.info({ taskId: task.id }, 'Generating PRP');
    const result = await retryAgentPrompt(
      () => this.#researcherAgent.prompt(prompt),
      { agentType: 'Researcher', operation: 'generatePRP' }
    );

    // Step 3: Surface agent-level failures. Groundswell wraps harness/LLM
    // failures into { status: 'error' } responses (no throw).
    if (result.status === 'error') {
      throw new Error(
        `Researcher agent failed: ${result.error?.message ?? 'unknown agent error'}`
      );
    }

    // Step 4: Read the PRP JSON the researcher wrote to the file (the file is
    // the contract — mirrors the architect pattern). Reasoning models like
    // glm-5.2 reliably write files but do NOT reliably honor responseFormat
    // for structured JSON, so we cannot trust result.data here.
    let prpJsonText: string;
    try {
      prpJsonText = await readFile(prpOutputPath, 'utf-8');
    } catch {
      throw new Error(`Researcher did not write PRP file at ${prpOutputPath}`);
    }
    // Tolerate a markdown-fenced JSON block ONLY if the raw file isn't itself
    // valid JSON (some agents wrap output in ```json fences). Parse the raw
    // text first; a non-greedy regex sweep would corrupt valid JSON whose
    // string VALUES contain code fences (e.g. a ```yaml block inside `context`).
    let parsed: unknown;
    try {
      parsed = JSON.parse(prpJsonText);
    } catch {
      const fenced = prpJsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) {
        parsed = JSON.parse(fenced[1].trim());
      } else {
        throw new Error(
          `Researcher wrote non-JSON PRP file at ${prpOutputPath}`
        );
      }
    }

    // Step 5: Validate the file contents against the schema.
    const validated = PRPDocumentSchema.parse(parsed);

    // Step 4: Apply compression if enabled
    const { compressed, originalTokens, compressedTokens } =
      this.#compressPRP(validated);

    // Log compression metrics
    if (originalTokens !== compressedTokens) {
      const ratio = originalTokens / compressedTokens;
      this.#logger.info(
        {
          taskId: task.id,
          level: this.#compression,
          originalTokens,
          compressedTokens,
          reduction: ((1 - compressedTokens / originalTokens) * 100).toFixed(1),
          ratio: ratio.toFixed(2),
        },
        'PRP compression applied'
      );
    }

    // Step 5: Write PRP to file (throws PRPFileError directly on failure)
    await this.#writePRPToFile(compressed);

    // Step 6: Save cache metadata if cache is enabled
    if (!this.#noCache) {
      const currentHash = this.#computeTaskHash(task, backlog);
      await this.#saveCacheMetadata(
        task.id,
        currentHash,
        compressed,
        originalTokens,
        compressedTokens
      );
    }

    return compressed;
  }

  /**
   * Writes PRP content to markdown file in session directory
   *
   * @remarks
   * Creates the prps directory if it doesn't exist and writes the PRP
   * as markdown. The filename is sanitized from the taskId (dots replaced
   * with underscores).
   *
   * File location: {sessionPath}/prps/{taskId}.md
   *
   * @param prp - The PRPDocument to write
   * @throws {PRPFileError} If file write fails
   * @private
   */
  async #writePRPToFile(prp: PRPDocument): Promise<void> {
    // Sanitize taskId for filename (replace dots with underscores)
    const filename = prp.taskId.replace(/\./g, '_') + '.md';

    // Create prps directory path
    const prpsDir = join(this.sessionPath, 'prps');
    const filePath = join(prpsDir, filename);

    try {
      // Create prps directory if it doesn't exist
      await mkdir(prpsDir, { recursive: true });

      // Format PRP as markdown
      const markdown = this.#formatPRPAsMarkdown(prp);

      // Write PRP file with proper permissions
      await writeFile(filePath, markdown, { mode: 0o644 });

      this.#logger.info({ taskId: prp.taskId, filePath }, 'PRP written');
    } catch (error) {
      throw new PRPFileError(prp.taskId, filePath, error);
    }
  }

  /**
   * Formats PRPDocument as markdown string
   *
   * @remarks
   * Converts the structured PRPDocument into a markdown format suitable
   * for human reading and version control. Follows the PRP template structure
   * with sections for objective, context, implementation steps, validation
   * gates, success criteria, and references.
   *
   * @param prp - The PRPDocument to format
   * @returns Markdown string representation of the PRP
   * @private
   */
  #formatPRPAsMarkdown(prp: PRPDocument): string {
    // Build implementation steps section
    const implementationStepsMd = prp.implementationSteps
      .map((step, i) => `${i + 1}. ${step}`)
      .join('\n');

    // Build validation gates section
    const validationGatesMd = prp.validationGates
      .map(
        (gate, i) =>
          `### Level ${i + 1}: ${gate.level}\n\n${
            gate.command !== null ? gate.command : 'Manual validation required'
          }`
      )
      .join('\n\n');

    // Build success criteria section
    const successCriteriaMd = prp.successCriteria
      .map(c => `- [ ] ${c.description}`)
      .join('\n');

    // Build references section
    const referencesMd = prp.references.map(r => `- ${r}`).join('\n');

    return `# PRP for ${prp.taskId}

## Objective

${prp.objective}

## Context

${prp.context}

## Implementation Steps

${implementationStepsMd}

## Validation Gates

${validationGatesMd}

## Success Criteria

${successCriteriaMd}

## References

${referencesMd}
`;
  }

  /**
   * Gets cache statistics for metrics collection
   *
   * @remarks
   * Returns cache hit/miss statistics for integration with MetricsCollector.
   *
   * @returns Cache statistics with hit/miss data
   */
  getCacheStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.#cacheHits + this.#cacheMisses;
    return {
      hits: this.#cacheHits,
      misses: this.#cacheMisses,
      hitRate: total > 0 ? this.#cacheHits / total : 0,
    };
  }
}

// PATTERN: Export type for convenience
export type { PRPDocument };
