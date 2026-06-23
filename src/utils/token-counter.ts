/**
 * Token Counter Utility
 *
 * @module utils/token-counter
 *
 * @remarks
 * Provides accurate token counting for text content using tiktoken.
 * Uses GPT-4 tokenizer (cl100k_base) as approximation for glm-5.2
 * compatibility since tiktoken doesn't have native GLM-4 support.
 *
 * @example
 * ```typescript
 * import { TokenCounter } from './utils/token-counter.js';
 *
 * const counter = new TokenCounter();
 * const tokens = counter.countTokens('Hello, world!');
 * console.log(`Token count: ${tokens}`);
 * ```
 */

import { encoding_for_model, get_encoding } from 'tiktoken';
import { getLogger } from './logger.js';
import type { Logger } from './logger.js';

/**
 * Token encoding options
 */
export type TokenEncoding = 'cl100k_base' | 'gpt-4' | 'gpt-3.5-turbo';

/**
 * Token counter configuration options
 */
export interface TokenCounterOptions {
  /** Encoding to use for tokenization (default: cl100k_base) */
  encoding?: TokenEncoding;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Token counting result
 */
export interface TokenCountResult {
  /** Total number of tokens */
  tokens: number;
  /** Character count */
  characters: number;
  /** Estimated tokens per character ratio */
  ratio: number;
  /** Whether token count would exceed limit */
  exceedsLimit?: boolean;
  /** Percentage of limit used (0-100) */
  limitPercentage?: number;
}

/**
 * Persona token limits from agent-factory.ts
 *
 * @remarks
 * These are the maximum token limits for different agent personas.
 * Used for warning when approaching limits.
 */
export const PERSONA_TOKEN_LIMITS = {
  architect: 8192,
  researcher: 4096,
  coder: 4096,
  qa: 4096,
} as const;

/**
 * Token counter for accurate token measurement
 *
 * @remarks
 * Uses tiktoken library for accurate GPT-4 token counting.
 * Provides methods for counting tokens, checking limits, and estimating.
 *
 * The cl100k_base encoding is used as it's the closest available
 * approximation to GLM-4 tokenization in tiktoken.
 */
export class TokenCounter {
  readonly #logger: Logger;
  readonly #encoding: TiktokenEncoding;
  readonly #encodingName: string;

  /**
   * Creates a new TokenCounter instance
   *
   * @param options - Configuration options
   */
  constructor(options: TokenCounterOptions = {}) {
    this.#logger = getLogger('TokenCounter');
    const { encoding = 'cl100k_base' } = options;
    this.#encodingName = encoding;

    // Initialize encoding - use cl100k_base for GPT-4 compatibility
    try {
      if (encoding === 'gpt-4' || encoding === 'gpt-3.5-turbo') {
        this.#encoding = encoding_for_model(encoding);
      } else {
        this.#encoding = get_encoding(encoding);
      }
      this.#logger.debug(`Initialized TokenCounter with ${encoding} encoding`);
    } catch (error) {
      this.#logger.warn(
        { error, encoding },
        'Failed to initialize encoding, falling back to cl100k_base'
      );
      this.#encoding = get_encoding('cl100k_base');
    }
  }

  /**
   * Counts tokens in text using tiktoken
   *
   * @param text - Text to count tokens for
   * @returns Number of tokens in the text
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * const tokens = counter.countTokens('Hello, world!');
   * // Returns: 3 (approximately)
   * ```
   */
  countTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    try {
      const tokens = this.#encoding.encode(text);
      return tokens.length;
    } catch (error) {
      this.#logger.warn({ error }, 'Failed to encode text, using fallback');
      // Fallback: rough estimate of 1 token per 4 characters
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Counts tokens and returns detailed result
   *
   * @param text - Text to analyze
   * @param limit - Optional token limit for comparison
   * @returns Detailed token count result
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * const result = counter.count('Hello, world!', 100);
   * console.log(result.tokens, result.percentage);
   * ```
   */
  count(text: string, limit?: number): TokenCountResult {
    const tokens = this.countTokens(text);
    const characters = text.length;
    const ratio = characters > 0 ? tokens / characters : 0;

    const result: TokenCountResult = {
      tokens,
      characters,
      ratio,
    };

    if (limit !== undefined && limit > 0) {
      result.exceedsLimit = tokens > limit;
      result.limitPercentage = (tokens / limit) * 100;
    }

    return result;
  }

  /**
   * Estimates if text will exceed token limit
   *
   * @param text - Text to check
   * @param limit - Token limit
   * @returns True if text would exceed the limit
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * if (counter.willExceedLimit(longText, 4096)) {
   *   console.log('Text is too long');
   * }
   * ```
   */
  willExceedLimit(text: string, limit: number): boolean {
    return this.countTokens(text) > limit;
  }

  /**
   * Checks if text is approaching token limit (80% threshold)
   *
   * @param text - Text to check
   * @param limit - Token limit
   * @returns True if tokens exceed 80% of limit
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * if (counter.isApproachingLimit(text, 4096)) {
   *   this.#logger.warn('Approaching token limit');
   * }
   * ```
   */
  isApproachingLimit(text: string, limit: number): boolean {
    const tokens = this.countTokens(text);
    return tokens > limit * 0.8;
  }

  /**
   * Gets the percentage of token limit used
   *
   * @param text - Text to check
   * @param limit - Token limit
   * @returns Percentage of limit used (0-100+)
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * const percentage = counter.getLimitPercentage(text, 4096);
   * console.log(`${percentage.toFixed(1)}% of limit used`);
   * ```
   */
  getLimitPercentage(text: string, limit: number): number {
    const tokens = this.countTokens(text);
    return (tokens / limit) * 100;
  }

  /**
   * Compresses text to fit within token limit
   *
   * @param text - Text to compress
   * @param limit - Token limit
   * @param keepHead - Percentage of limit to keep from start (default: 0.5)
   * @returns Compressed text with ellipsis in middle
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * const compressed = counter.compressToFit(longText, 1000);
   * // Returns: first 500 chars + ellipsis + last 500 chars
   * ```
   */
  compressToFit(text: string, limit: number, keepHead: number = 0.5): string {
    const currentTokens = this.countTokens(text);

    if (currentTokens <= limit) {
      return text;
    }

    // Calculate how many characters to keep
    const targetTokens = Math.floor(limit * 0.9); // 90% of limit for safety
    const avgCharsPerToken = text.length / currentTokens;
    const totalChars = Math.floor(targetTokens * avgCharsPerToken);
    const headChars = Math.floor(totalChars * keepHead);

    if (headChars * 2 >= text.length) {
      // Text is only slightly over, just truncate end
      return text.slice(0, totalChars);
    }

    const tailChars = totalChars - headChars;
    const ellipsis = '\n\n... (compressed for token limit) ...\n\n';

    return text.slice(0, headChars) + ellipsis + text.slice(-tailChars);
  }

  /**
   * Frees the encoding resources
   *
   * @remarks
   * Call this when done using the TokenCounter to free memory.
   * tiktoken encodings should be freed when no longer needed.
   *
   * @example
   * ```typescript
   * const counter = new TokenCounter();
   * // ... use counter ...
   * counter.dispose();
   * ```
   */
  dispose(): void {
    try {
      this.#encoding.free();
      this.#logger.debug('Disposed encoding resources');
    } catch (error) {
      this.#logger.warn({ error }, 'Failed to dispose encoding');
    }
  }
}

/**
 * Type for tiktoken encoding
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TiktokenEncoding = any;

/**
 * Convenience function to count tokens without instantiating class
 *
 * @param text - Text to count tokens for
 * @param encoding - Encoding to use (default: cl100k_base)
 * @returns Number of tokens
 *
 * @example
 * ```typescript
 * import { countTokens } from './utils/token-counter.js';
 *
 * const tokens = countTokens('Hello, world!');
 * ```
 */
export function countTokens(
  text: string,
  encoding: TokenEncoding = 'cl100k_base'
): number {
  const counter = new TokenCounter({ encoding });
  try {
    return counter.countTokens(text);
  } finally {
    counter.dispose();
  }
}

/**
 * Convenience function to check if text exceeds token limit
 *
 * @param text - Text to check
 * @param limit - Token limit
 * @param encoding - Encoding to use (default: cl100k_base)
 * @returns True if text exceeds limit
 *
 * @example
 * ```typescript
 * import { willExceedLimit } from './utils/token-counter.js';
 *
 * if (willExceedLimit(longText, 4096)) {
 *   console.log('Text too long');
 * }
 * ```
 */
export function willExceedLimit(
  text: string,
  limit: number,
  encoding: TokenEncoding = 'cl100k_base'
): boolean {
  const counter = new TokenCounter({ encoding });
  try {
    return counter.willExceedLimit(text, limit);
  } finally {
    counter.dispose();
  }
}
