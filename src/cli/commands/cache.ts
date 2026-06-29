/**
 * Cache command for PRP cache management
 *
 * @module cli/commands/cache
 *
 * @remarks
 * Provides cache management operations including statistics display,
 * expired entry cleanup, and full cache clearing. Supports multiple
 * output formats (table, json) and safety features (dry-run, confirmation).
 *
 * @example
 * ```typescript
 * import { CacheCommand } from './cli/commands/cache.js';
 *
 * const command = new CacheCommand();
 * await command.execute('stats', { output: 'table' });
 * ```
 */

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { SessionManager } from '../../core/session-manager.js';
import {
  CacheManager,
  type CacheStatistics,
} from '../../utils/cache-manager.js';
import { getLogger, type Logger } from '../../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('CacheCommand'));

/**
 * Cache command options
 */
export interface CacheOptions {
  /** Output format (table or json) */
  output: 'table' | 'json';

  /** Force action without confirmation */
  force: boolean;

  /** Show what would be done without executing */
  dryRun: boolean;

  /** Session ID (optional, defaults to latest) */
  session?: string;
}

/**
 * Cache command handler class
 *
 * @remarks
 * Executes cache management commands with various actions for stats,
 * cleanup, and clearing. Integrates with SessionManager for session
 * discovery and CacheManager for cache operations.
 */
export class CacheCommand {
  readonly #planDir: string;
  readonly #prdPath: string;

  /**
   * Creates a new CacheCommand instance
   *
   * @param planDir - Path to plan directory (default: resolve('plan'))
   * @param prdPath - Path to PRD file (default: resolve('PRD.md'))
   */
  constructor(
    planDir: string = resolve('plan'),
    prdPath: string = resolve('PRD.md')
  ) {
    this.#planDir = planDir;
    this.#prdPath = prdPath;
  }

  /**
   * Executes the cache command
   *
   * @param action - Action to perform (stats, clean, clear)
   * @param options - Command options
   * @throws {Error} If action is unknown or execution fails
   *
   * @example
   * ```typescript
   * const command = new CacheCommand();
   * await command.execute('stats', { output: 'table' });
   * await command.execute('clean', { dryRun: true });
   * await command.execute('clear', { force: true });
   * ```
   */
  async execute(action: string, options: CacheOptions): Promise<void> {
    try {
      switch (action) {
        case 'stats':
          await this.#showStats(options);
          break;
        case 'clean':
          await this.#cleanCache(options);
          break;
        case 'clear':
          await this.#clearCache(options);
          break;
        default:
          console.error(chalk.red(`Unknown action: ${action}`));
          console.info('Valid actions: stats, clean, clear');
          process.exit(1);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(chalk.red('Error:'), errorMessage);
      logger().error({ error }, 'Cache command failed');
      process.exit(1);
    }
  }

  /**
   * Shows cache statistics
   *
   * @param options - Command options
   */
  async #showStats(options: CacheOptions): Promise<void> {
    const sessionState = await this.#loadSession(options.session);
    const manager = new CacheManager(sessionState.metadata.path);
    const stats = await manager.getStats();

    if (options.output === 'json') {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(this.#formatStatsTable(stats));
    }
  }

  /**
   * Cleans expired cache entries
   *
   * @param options - Command options
   */
  async #cleanCache(options: CacheOptions): Promise<void> {
    const sessionState = await this.#loadSession(options.session);
    const manager = new CacheManager(sessionState.metadata.path);

    // Show what would be cleaned
    const stats = await manager.getStats();
    console.log(chalk.yellow(`Found ${stats.expiredEntries} expired entries`));

    if (options.dryRun) {
      console.log(chalk.gray('\nDry run - no changes made'));
      return;
    }

    const result = await manager.cleanExpired();

    console.log(chalk.green(`\nRemoved: ${result.removed} entries`));
    if (result.failed > 0) {
      console.log(chalk.red(`Failed: ${result.failed} entries`));
    }
    console.log(chalk.gray(`Duration: ${result.duration.toFixed(2)}ms`));
  }

  /**
   * Clears all cache entries
   *
   * @param options - Command options
   */
  async #clearCache(options: CacheOptions): Promise<void> {
    const sessionState = await this.#loadSession(options.session);
    const manager = new CacheManager(sessionState.metadata.path);
    const stats = await manager.getStats();

    console.log(
      chalk.yellow(`About to remove ${stats.totalEntries} cache entries`)
    );

    if (!options.force) {
      const answer = await this.#promptConfirmation('Continue? (y/N): ');
      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        return;
      }
    }

    if (options.dryRun) {
      console.log(chalk.gray('\nDry run - no changes made'));
      return;
    }

    const result = await manager.clear();

    console.log(chalk.green(`\nRemoved: ${result.removed} entries`));
    if (result.failed > 0) {
      console.log(chalk.red(`Failed: ${result.failed} entries`));
    }
    console.log(chalk.gray(`Duration: ${result.duration.toFixed(2)}ms`));
  }

  /**
   * Loads session based on options
   *
   * @param sessionId - Optional session ID to load
   * @returns Loaded session state
   * @throws {Error} If session not found
   */
  async #loadSession(sessionId?: string) {
    if (sessionId) {
      const sessions = await SessionManager.listSessions(this.#planDir);
      const session = sessions.find(
        s => s.hash.startsWith(sessionId) || s.id === sessionId
      );
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const manager = new SessionManager(this.#prdPath, this.#planDir);
      return await manager.loadSession(session.path);
    }

    const latest = await SessionManager.findLatestSession(this.#planDir);
    if (!latest) {
      throw new Error('No session found');
    }
    const manager = new SessionManager(this.#prdPath, this.#planDir);
    return await manager.loadSession(latest.path);
  }

  /**
   * Formats statistics as a table
   *
   * @param stats - Cache statistics
   * @returns Formatted table string
   */
  #formatStatsTable(stats: CacheStatistics): string {
    const table = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      colWidths: [30, 20],
      chars: {
        top: '─',
        'top-mid': '┬',
        'top-left': '┌',
        'top-right': '┐',
        bottom: '─',
        'bottom-mid': '┴',
        'bottom-left': '└',
        'bottom-right': '┘',
        left: '│',
        'left-mid': '├',
        mid: '─',
        'mid-mid': '┼',
        right: '│',
        'right-mid': '┤',
        middle: '│',
      },
    });

    table.push(['Total Entries', stats.totalEntries.toString()]);
    table.push(['Total Size', this.#formatBytes(stats.totalBytes)]);
    table.push(['Expired Entries', stats.expiredEntries.toString()]);
    table.push([
      'Oldest Entry',
      stats.oldestEntry ? this.#formatAge(stats.oldestEntry) : 'N/A',
    ]);
    table.push([
      'Newest Entry',
      stats.newestEntry ? this.#formatAge(stats.newestEntry) : 'N/A',
    ]);

    return '\n' + table.toString();
  }

  /**
   * Formats bytes as human-readable string
   *
   * @param bytes - Number of bytes
   * @returns Formatted string
   */
  #formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /**
   * Formats age as human-readable string
   *
   * @param timestamp - Timestamp to calculate age from
   * @returns Formatted age string
   */
  #formatAge(timestamp: number): string {
    const age = Date.now() - timestamp;
    if (age < 60 * 1000) return `${Math.floor(age / 1000)}s ago`;
    if (age < 60 * 60 * 1000) return `${Math.floor(age / (60 * 1000))}m ago`;
    if (age < 24 * 60 * 60 * 1000)
      return `${Math.floor(age / (60 * 60 * 1000))}h ago`;
    return `${Math.floor(age / (24 * 60 * 60 * 1000))}d ago`;
  }

  /**
   * Prompts user for confirmation
   *
   * @param prompt - Prompt text
   * @returns User's answer
   */
  #promptConfirmation(prompt: string): Promise<string> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise(resolve => {
      rl.question(prompt, answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}
