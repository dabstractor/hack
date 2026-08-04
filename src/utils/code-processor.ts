/**
 * Code Processing Utilities
 *
 * Utilities for code minification, compression, and normalization
 * for AI prompts and optimization.
 */

import { minify } from 'terser';
import * as esbuild from 'esbuild';

export interface ProcessingOptions {
  // Minification options
  minify?: boolean;
  removeComments?: boolean;
  removeBlankLines?: boolean;
  mangle?: boolean;

  // Extraction options
  extractLines?: { start: number; end: number };
  extractFunction?: string;
  extractClass?: string;

  // AI optimization
  forAI?: boolean;
  maxTokens?: number;

  // Output format
  format?: 'minified' | 'readable' | 'compressed';
}

export interface CodeSnippet {
  code: string;
  startLine: number;
  endLine: number;
  language: string;
}

/**
 * Comprehensive code processing utility
 */
export class CodeProcessor {
  /**
   * Process code according to specified options
   */
  async process(
    code: string,
    options: ProcessingOptions = {}
  ): Promise<string> {
    let result = code;

    // Step 1: Extraction
    if (options.extractLines) {
      result = this.extractLineRange(result, options.extractLines);
    } else if (options.extractFunction) {
      result = this.extractFunction(result, options.extractFunction);
    } else if (options.extractClass) {
      result = this.extractClass(result, options.extractClass);
    }

    // Step 2: AI Optimization
    if (options.forAI) {
      result = await this.optimizeForAI(result, options.maxTokens);
    }

    // Step 3: Comment and blank line removal
    if (options.removeComments) {
      result = this.removeComments(result);
    }
    if (options.removeBlankLines) {
      result = this.removeBlankLines(result);
    }

    // Step 4: Minification
    if (options.minify) {
      result = await this.minify(result, options);
    }

    // Step 5: Formatting
    if (options.format === 'readable') {
      result = this.makeReadable(result);
    }

    return result;
  }

  /**
   * Extract a range of lines from code (1-indexed)
   */
  extractLineRange(
    code: string,
    range: { start: number; end: number }
  ): string {
    const lines = code.split('\n');
    return lines.slice(range.start - 1, range.end).join('\n');
  }

  /**
   * Extract a function by name using brace counting
   */
  extractFunction(code: string, functionName: string): string {
    const lines = code.split('\n');

    // Match actual function declarations/definitions anchored to the start of
    // the relevant token — NOT a bare 'function' keyword (which would falsely
    // match comment lines like '// Sample function for testing'). Require the
    // keyword/identifier to begin the statement (after optional whitespace),
    // optionally preceded by 'export'/'async' modifiers.
    const declRe = new RegExp(
      `^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${functionName}\\b|const\\s+${functionName}\\s*=|${functionName}\\s*[:=])`
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comment lines so the bare 'function' word in a comment never
      // starts extraction at the wrong line.
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      // Check if this line starts the function
      if (declRe.test(line.trimStart())) {
        // Find the opening brace
        const startLine = i;
        let braceCount = 0;
        let foundBrace = false;

        // Count braces from the starting line
        for (let j = i; j < lines.length; j++) {
          const openBraces = (lines[j].match(/{/g) || []).length;
          const closeBraces = (lines[j].match(/}/g) || []).length;

          if (openBraces > 0) {
            foundBrace = true;
          }

          braceCount += openBraces - closeBraces;

          // The closing line frequently holds only a '}' (openBraces === 0),
          // so the end condition must NOT require openBraces > 0 on this line —
          // only that we have seen an opening brace and braces are balanced.
          if (foundBrace && braceCount === 0) {
            // Found the end
            return lines
              .slice(startLine, j + 1)
              .join('\n')
              .trim();
          }
        }
      }
    }

    return code;
  }

  /**
   * Extract a class by name using brace counting
   */
  extractClass(code: string, className: string): string {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line starts the class
      if (new RegExp(`class\\s+${className}`).test(line)) {
        let braceCount = 0;
        let foundBrace = false;

        // Count braces from the starting line
        for (let j = i; j < lines.length; j++) {
          const openBraces = (lines[j].match(/{/g) || []).length;
          const closeBraces = (lines[j].match(/}/g) || []).length;

          if (openBraces > 0) {
            foundBrace = true;
          }

          braceCount += openBraces - closeBraces;

          // The closing line frequently holds only a '}' (openBraces === 0),
          // so the end condition must NOT require openBraces > 0 on this line —
          // only that we have seen an opening brace and braces are balanced.
          if (foundBrace && braceCount === 0) {
            // Found the end
            return lines
              .slice(i, j + 1)
              .join('\n')
              .trim();
          }
        }
      }
    }

    return code;
  }

  /**
   * Optimize code for AI prompts
   * Removes comments, blank lines, and truncates if needed
   */
  async optimizeForAI(code: string, maxTokens: number = 4000): Promise<string> {
    // Remove comments
    let result = code.replace(/\/\/.*$/gm, '');
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove blank lines
    result = result.replace(/^\s*[\r\n]/gm, '');

    // Use esbuild for lightweight optimization (no mangling)
    try {
      const transformed = await esbuild.transform(result, {
        loader: 'ts',
        minifyWhitespace: true,
        minifyIdentifiers: false,
        minifySyntax: false,
        treeShaking: true,
      });

      result = transformed.code;
    } catch (error) {
      // If esbuild fails, use the comment-removed version
      console.warn(
        'esbuild transform failed, using basic optimization:',
        error
      );
    }

    // Truncate if too long
    const maxChars = maxTokens * 4;
    if (result.length > maxChars) {
      const keep = Math.floor((maxChars - 50) / 2);
      result =
        result.slice(0, keep) +
        '\n// ... (truncated) ...\n' +
        result.slice(-keep);
    }

    return result;
  }

  /**
   * Minify code using Terser
   */
  async minify(code: string, options: ProcessingOptions): Promise<string> {
    try {
      // First, strip TypeScript types for Terser (which doesn't support TS)
      const jsCode = code
        .replace(/:\s*\w+/g, '')
        .replace(/:\s*\{[^}]+\}/g, '')
        .replace(/:\s*\([^)]+\)/g, '');

      const result = await minify(jsCode, {
        compress: true,
        mangle: options.mangle ?? false,
        format: {
          comments: false,
          beautify: false,
        },
        ecma: 2020,
        keep_classnames: true,
        keep_fnames: true,
      });

      // MinifyOutput doesn't have an error property - errors are thrown
      // The minify function throws on error, so if we get here, it succeeded
      return result.code || code;
    } catch (error) {
      console.warn('Terser minification failed:', error);
      // Fallback to basic compression
      return this.compressWhitespace(code);
    }
  }

  /**
   * Make code more readable with formatting
   */
  makeReadable(code: string): string {
    return code
      .replace(/;/g, ';\n')
      .replace(/\{/g, ' {\n')
      .replace(/\}/g, '\n}\n')
      .replace(/^\s+/gm, '  ');
  }

  /**
   * Extract complete code blocks (functions, classes, etc.)
   */
  extractCodeBlocks(code: string): CodeSnippet[] {
    const lines = code.split('\n');
    const snippets: CodeSnippet[] = [];

    let currentBlock: string[] = [];
    let blockStartLine = 0;
    let braceCount = 0;
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect function/class start
      if (
        /^\s*(function|class|const\s+\w+\s*=|(?:async\s+)?\w+\s*=\s*(?:async\s+)?\(.*\)\s*=>)/.test(
          line
        )
      ) {
        inBlock = true;
        blockStartLine = i + 1;
        currentBlock = [line];

        // Count opening braces
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        braceCount = openBraces - closeBraces;

        continue;
      }

      if (inBlock) {
        currentBlock.push(line);

        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        braceCount += openBraces - closeBraces;

        // Block complete
        if (braceCount === 0) {
          snippets.push({
            code: currentBlock.join('\n'),
            startLine: blockStartLine,
            endLine: i + 1,
            language: 'typescript',
          });

          inBlock = false;
          currentBlock = [];
        }
      }
    }

    return snippets;
  }

  /**
   * Remove comments from code
   */
  removeComments(code: string): string {
    // Preserve strings first
    const strings: string[] = [];
    code = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, match => {
      strings.push(match);
      return `__STRING_${strings.length - 1}__`;
    });

    // Remove single-line comments (but not in strings)
    code = code.replace(/\/\/.*$/gm, '');

    // Remove multi-line comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove HTML-style comments
    code = code.replace(/<!--[\s\S]*?-->/g, '');

    // Restore strings
    code = code.replace(
      /__STRING_(\d+)__/g,
      (_, index) => strings[parseInt(index)]
    );

    return code;
  }

  /**
   * Remove blank lines from code
   */
  removeBlankLines(code: string): string {
    return code.replace(/^\s*[\r\n]/gm, '');
  }

  /**
   * Compress whitespace in code
   */
  compressWhitespace(code: string): string {
    return code
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\s*([{}();,:])\s*/g, '$1') // Remove spaces around punctuation
      .replace(/\s*=\s*\{/g, '={') // Join assignment directly to object literal (e.g. 'x = {' -> 'x={')
      .replace(/\s*\{\s*/g, '{') // Remove spaces around opening brace
      .replace(/\s*\}\s*/g, '}') // Remove spaces around closing brace
      .trim();
  }

  /**
   * Count approximate tokens in code
   * Rough estimate: 1 token ≈ 4 characters
   */
  countTokens(code: string): number {
    return Math.ceil(code.length / 4);
  }

  /**
   * Create a file reference string for large content
   * Used when file content is too large to include directly
   *
   * @param filePath - Path to the file
   * @param lineStart - Starting line number (1-indexed)
   * @param lineEnd - Ending line number (1-indexed)
   * @returns File reference string
   *
   * @example
   * ```typescript
   * const processor = new CodeProcessor();
   * const ref = processor.createFileReference('src/models.ts', 50, 100);
   * // Returns: "See src/models.ts lines 50-100"
   * ```
   */
  createFileReference(
    filePath: string,
    lineStart: number,
    lineEnd: number
  ): string {
    return `See ${filePath} lines ${lineStart}-${lineEnd}`;
  }

  /**
   * Truncate code to max tokens with ellipsis
   */
  truncateToTokens(code: string, maxTokens: number): string {
    const maxChars = maxTokens * 4;
    if (code.length <= maxChars) return code;

    const keep = Math.floor((maxChars - 20) / 2);
    return (
      code.slice(0, keep) + '\n// ... (truncated) ...\n' + code.slice(-keep)
    );
  }

  /**
   * Extract imports from code
   */
  extractImports(code: string): string[] {
    const patterns = [
      /import\s+{[^}]+}\s+from\s+['"][^'"]+['"]/g,
      /import\s+\w+\s+from\s+['"][^'"]+['"]/g,
      /import\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"]/g,
      /import\s+['"][^'"]+['"]/g,
    ];

    const imports: string[] = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        imports.push(match[0]);
      }
    }

    return imports;
  }

  /**
   * Normalize code for consistent formatting
   */
  normalizeCode(code: string): string {
    // Remove trailing whitespace
    let result = code.replace(/[ \t]+$/gm, '');

    // Remove multiple consecutive blank lines
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n');

    // Ensure consistent spacing around braces
    result = result.replace(/\s*\{\s*/g, ' {\n');
    result = result.replace(/\s*\}\s*/g, '\n}\n');

    return result.trim();
  }
}

/**
 * Quick reference utility functions
 */
export const codeUtils = {
  /**
   * Remove comments
   */
  removeComments: (code: string): string => {
    return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  },

  /**
   * Remove blank lines
   */
  removeBlankLines: (code: string): string => {
    return code.replace(/^\s*[\r\n]/gm, '');
  },

  /**
   * Compress whitespace
   */
  compressWhitespace: (code: string): string => {
    return code.replace(/\s+/g, ' ').trim();
  },

  /**
   * Extract line range
   */
  extractLines: (code: string, start: number, end: number): string => {
    const lines = code.split('\n');
    return lines.slice(start - 1, end).join('\n');
  },

  /**
   * Count lines
   */
  countLines: (code: string): number => {
    return code.split('\n').length;
  },

  /**
   * Count tokens (rough estimate)
   */
  countTokens: (code: string): number => {
    return Math.ceil(code.length / 4);
  },

  /**
   * Check if code exceeds token limit
   */
  isTooLong: (code: string, maxTokens: number): boolean => {
    return Math.ceil(code.length / 4) > maxTokens;
  },

  /**
   * Truncate with ellipsis
   */
  truncate: (code: string, maxChars: number): string => {
    if (code.length <= maxChars) return code;
    const ellipsis = ' ... ';
    const keep = Math.floor((maxChars - ellipsis.length) / 2);
    return code.slice(0, keep) + ellipsis + code.slice(-keep);
  },
};

/**
 * Create a processor instance with default options
 *
 * @remarks
 * Options are passed to the process() method, not the constructor.
 * This is intentional to allow the same processor instance to be
 * reused with different options.
 */
export function createProcessor(
  _options: ProcessingOptions = {}
): CodeProcessor {
  return new CodeProcessor();
}

/**
 * Process code for AI prompts (common use case)
 */
export async function processForAI(
  code: string,
  maxTokens: number = 4000
): Promise<string> {
  const processor = new CodeProcessor();
  return processor.process(code, {
    forAI: true,
    maxTokens,
    removeComments: true,
    removeBlankLines: true,
  });
}

/**
 * Minify code for production (common use case)
 */
export async function minifyCode(code: string): Promise<string> {
  const processor = new CodeProcessor();
  // First remove comments and blank lines
  let result = processor.removeComments(code);
  result = processor.removeBlankLines(result);
  // Then minify
  return processor.process(result, {
    minify: true,
    mangle: true,
  });
}
