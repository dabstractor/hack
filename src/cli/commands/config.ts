/**
 * `.hack` configuration management command for the `hack config` subcommand
 * (PRD §9.7.8 — "The `hack config` Subcommand").
 *
 * @module cli/commands/config
 *
 * @remarks
 * Exposes the `.hack` configuration feature (PRD §9.7) through four actions —
 * `init`, `show`, `validate`, `path` — each consuming the authoritative config
 * primitives from `src/config/hack-config.ts` (no duplication of validated logic):
 *
 * - `init` writes a commented `<repoRoot>/.hack` template generated from
 *   {@link SCHEMA_MAP} (all §9.7.5 sections as commented examples), refuses to
 *   clobber without `--force`, appends `.hack.local` to `.gitignore` (deduped),
 *   and prints next-step guidance.
 * - `show` (default) prints every {@link SCHEMA_MAP} key with its resolved value
 *   and (with `--src`) the winning layer (`global`/`project`/`project-local`/
 *   `env`/`default`). Runs WITHOUT invoking any agent. Secret-suffixed keys are
 *   masked (`<redacted>`).
 * - `validate` lints `.hack` + `.hack.local` (or an explicit `<file>`); exits 1
 *   on secrets/type/range/parse hard errors and 0 on warnings-only (CI-friendly);
 *   never seeds `process.env`.
 * - `path` prints the resolved global / project / local paths actually consulted
 *   (`--global` / `--local` filter; no flag = all three).
 *
 * Mirrors the `CacheCommand` class convention (class shape, `async execute`,
 * try/catch → `process.exit`, `chalk`/`cli-table3`).
 *
 * @example
 * ```typescript
 * import { ConfigCommand } from './cli/commands/config.js';
 *
 * const cmd = new ConfigCommand(repoRoot);
 * await cmd.execute('show', { output: 'table', force: false, src: false, global: false, local: false });
 * ```
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  type HackConfigTier,
  type HackConfigValue,
  type HackConfigSchemaEntry,
  type MergedHackConfig,
  SCHEMA_MAP,
  _resetValidationWarnings,
  globalHackPath,
  isSecretKey,
  loadHackConfig,
  parseHackFile,
  validateHackTier,
} from '../../config/hack-config.js';
import { getLogger, type Logger } from '../../utils/logger.js';

let _logger: Logger | undefined;
const logger = (): Logger => (_logger ??= getLogger('ConfigCommand'));

/**
 * Options for the `hack config` subcommand.
 *
 * @remarks
 * All flags are present on the single {@link ConfigOptions} object regardless of
 * which action consumes them (mirrors {@link CacheOptions}). Each flag is scoped
 * to a single action; unused flags are inert.
 *
 * - `output` — render format (`table` default, or `json`); consumed by `show`
 *   and `path`.
 * - `force` — `init` only: overwrite an existing `.hack`.
 * - `src` — `show` only: annotate each value with its winning layer.
 * - `global` — `path` only: print the global config path.
 * - `local` — `path` only: print the project-local config path.
 */
export interface ConfigOptions {
  /** Output format (table or json). */
  output: 'table' | 'json';
  /** Overwrite an existing `.hack` (init only). */
  force: boolean;
  /** Annotate each value with its source layer (show only). */
  src: boolean;
  /** Print the global config path (path only). */
  global: boolean;
  /** Print the project-local config path (path only). */
  local: boolean;
}

/**
 * The SHOW-layer source attribution label (PRD §9.7.8/§9.7.10).
 *
 * @remarks
 * Extends {@link HackConfigTier} with two subcommand-only layers: `'env'` (a
 * shell/env var that won over the file tiers, per §9.2.1) and `'default'` (the
 * schema default — no file or env value present). The `'cli'` layer (§9.2.1
 * layer 7) is structurally N/A to a subcommand that does not receive pipeline
 * flags, so it is intentionally absent (see {@link ConfigCommand.#showAction}).
 */
type ShowSource = HackConfigTier | 'env' | 'default';

/**
 * Handler class for the `hack config` subcommand (PRD §9.7.8).
 *
 * @remarks
 * Constructed with a resolved `repoRoot` (the `.action()` in
 * {@link src/cli/index.ts} calls `resolveRepositoryRoot(process.cwd())` itself
 * because the bootstrap `chdir` runs AFTER subcommand dispatch). `execute()`
 * dispatches to one of four private actions and exits the process on completion
 * or error.
 */
export class ConfigCommand {
  readonly #repoRoot: string;

  /**
   * Creates a new `ConfigCommand` instance.
   *
   * @param repoRoot - The resolved repository root (project files live here).
   */
  constructor(repoRoot: string) {
    this.#repoRoot = repoRoot;
  }

  /**
   * Executes the `hack config` subcommand.
   *
   * @param action - Action to perform (`init`, `show`, `validate`, `path`).
   * @param options - Command options.
   * @param fileArg - Optional explicit file for `validate` (else `.hack` + `.hack.local`).
   * @throws {Error} (via `process.exit`) on unknown action or execution failure.
   */
  async execute(
    action: string,
    options: ConfigOptions,
    fileArg?: string
  ): Promise<void> {
    try {
      switch (action) {
        case 'init':
          await this.#initAction(options);
          break;
        case 'show':
          await this.#showAction(options);
          break;
        case 'validate':
          await this.#validateAction(options, fileArg);
          break;
        case 'path':
          await this.#pathAction(options);
          break;
        default:
          console.error(chalk.red(`Unknown action: ${action}`));
          console.info('Valid actions: init, show, validate, path');
          process.exit(1);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(chalk.red('Error:'), errorMessage);
      logger().error({ error }, 'Config command failed');
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // init
  // -------------------------------------------------------------------------

  /**
   * `hack config init [--force]` — write a commented `<repoRoot>/.hack`
   * template (PRD §9.7.8/§9.7.4), refuse to clobber without `--force`, ensure
   * `.hack.local` is in `.gitignore`, and print next-step guidance.
   */
  async #initAction(options: ConfigOptions): Promise<void> {
    const target = join(this.#repoRoot, '.hack');
    if (existsSync(target) && !options.force) {
      console.error(
        chalk.red(
          `Refusing to overwrite existing ${target}; pass --force to replace it.`
        )
      );
      process.exit(1);
      return; // unreachable in production (process.exit terminates); guards test no-op exit
    }

    writeFileSync(target, this.#buildTemplate(), 'utf8');
    this.#ensureGitignoreHasHackLocal(this.#repoRoot);

    console.log(chalk.green(`Wrote ${target}`));
    console.log(
      chalk.gray(
        'Safe to commit (NO secrets — PRD §9.7.6). Edit personal overrides in .hack.local (gitignored).'
      )
    );
    console.log(
      chalk.cyan('\nNext steps:') +
        '\n  hack config show          # view the effective (merged) config' +
        '\n  hack config show --src    # annotate each value with its source layer' +
        '\n  hack config validate      # lint .hack + .hack.local (CI gate)' +
        '\n  hack config path          # print the discovery paths'
    );
    console.log(
      chalk.gray('\nDocs: .hack configuration is documented in PRD §9.7.')
    );
  }

  /**
   * Build a heavily-commented `.hack` template from {@link SCHEMA_MAP}
   * (PRD §9.7.4). Generated (not hand-authored / not `smol-toml.stringify`,
   * which cannot emit comments) so it stays in sync with the schema.
   */
  #buildTemplate(): string {
    const sections = new Map<string, HackConfigSchemaEntry[]>();
    for (const entry of SCHEMA_MAP) {
      const list = sections.get(entry.section);
      if (list) {
        list.push(entry);
      } else {
        sections.set(entry.section, [entry]);
      }
    }

    let out =
      '# <repoRoot>/.hack — PRP pipeline defaults (PRD §9.7). Generated by `hack config init`.\n' +
      '# Safe to commit (NO secrets — §9.7.6). Edit personal overrides in .hack.local (gitignored).\n' +
      '# Uncomment and edit a line to override its default.\n\n';

    for (const [section, entries] of sections) {
      out += `[${section}]\n`;
      for (const e of entries) {
        const def =
          e.defaultValue === undefined
            ? '...  # (unset)'
            : JSON.stringify(e.defaultValue);
        out += `# ${e.key} = ${def}\n`;
      }
      out += '\n';
    }
    return out.trimEnd() + '\n';
  }

  /**
   * Ensure `<repoRoot>/.gitignore` contains a `.hack.local` line (create the
   * file if absent; dedup the exact line so repeated `init` doesn't duplicate it).
   */
  #ensureGitignoreHasHackLocal(repoRoot: string): void {
    const gi = join(repoRoot, '.gitignore');
    const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    if (existing.split('\n').some(l => l.trim() === '.hack.local')) {
      return; // already present
    }
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    appendFileSync(gi, `${prefix}.hack.local\n`, 'utf8');
  }

  // -------------------------------------------------------------------------
  // show
  // -------------------------------------------------------------------------

  /**
   * `hack config show [--src] [-o table|json]` — print every {@link SCHEMA_MAP}
   * key with its resolved value (secrets masked) and (with `--src`) the winning
   * layer. Runs WITHOUT invoking any agent (PRD §9.7.8/§9.7.10).
   *
   * @remarks
   * `loadHackConfig` MUTATES `process.env` (it seeds undefined env vars from
   * the merged file values, per §9.2.1 env-over-file). So the set of env vars
   * that were pre-defined by the shell must be snapshotted BEFORE the load;
   * otherwise a file-seeded value would be indistinguishable from a real env
   * value and the source attribution would be wrong.
   */
  async #showAction(options: ConfigOptions): Promise<void> {
    // (1) Snapshot which env-linked env vars are pre-defined BEFORE loadHackConfig
    //     mutates process.env.
    const preEnv = new Set(
      SCHEMA_MAP.filter(
        e => e.envVar !== undefined && process.env[e.envVar] !== undefined
      ).map(e => e.envVar as string)
    );

    // (2) Load + merge all tiers (mutates process.env — see remarks above).
    const merged = loadHackConfig(this.#repoRoot);

    // (3) Resolve value + source per SCHEMA_MAP entry.
    interface ShowRow {
      key: string;
      value: string;
      source?: ShowSource;
    }
    const rows: ShowRow[] = SCHEMA_MAP.map(e => {
      const { value, source } = this.#resolveEntry(e, merged, preEnv);
      const row: ShowRow = {
        key: `${e.section}.${e.key}`,
        value: ConfigCommand.displayValue(e.key, value),
      };
      if (options.src) {
        row.source = source;
      }
      return row;
    });

    // (4) Render.
    if (options.output === 'json') {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    const table = new Table({
      head: options.src
        ? [chalk.cyan('Key'), chalk.cyan('Value'), chalk.cyan('Source')]
        : [chalk.cyan('Key'), chalk.cyan('Value')],
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
    for (const r of rows) {
      if (options.src) {
        table.push([r.key, r.value, r.source ?? '']);
      } else {
        table.push([r.key, r.value]);
      }
    }
    console.log('\n' + table.toString());
  }

  /**
   * Resolve a single {@link SCHEMA_MAP} entry to its effective value + source
   * layer (PRD §9.2.1 precedence).
   *
   * @returns `{ value, source }` where `source` ∈ {env, global, project,
   * project-local, default}. The `'cli'` layer (§9.2.1 layer 7) is structurally
   * N/A here — the `config show` subcommand does not receive pipeline flags.
   */
  #resolveEntry(
    entry: HackConfigSchemaEntry,
    merged: MergedHackConfig,
    preEnv: Set<string>
  ): { value: HackConfigValue | undefined; source: ShowSource } {
    const qualifiedKey = `${entry.section}.${entry.key}`;
    // (a) env-linked AND the env var was pre-defined by the shell → 'env' wins (§9.2.1 layer 5/6).
    //     preEnv membership guarantees process.env[envVar] is defined (string).
    if (entry.envVar !== undefined && preEnv.has(entry.envVar)) {
      const v = process.env[entry.envVar] as string;
      // Coerce the env string back to the schema type for display consistency.
      return {
        value: ConfigCommand.coerceEnv(v, entry.type),
        source: 'env',
      };
    }
    // (b) present in a file tier → the merged value + its recorded source.
    if (qualifiedKey in merged._sources) {
      return {
        value: merged[entry.section]?.[entry.key],
        source: merged._sources[qualifiedKey],
      };
    }
    // (c) no file/env value → schema default.
    return { value: entry.defaultValue, source: 'default' };
  }

  /**
   * Coerce a string env-var value back to the schema scalar type for display
   * (env vars are always strings; `show` renders values consistently with how
   * they'd appear in a `.hack` file).
   *
   * @remarks Static so all type branches (boolean/int/string + non-integer
   * fallback) are directly unit-testable.
   */
  static coerceEnv(
    raw: string,
    type: HackConfigSchemaEntry['type']
  ): HackConfigValue {
    if (type === 'boolean') {
      return raw === 'true';
    }
    if (type === 'int') {
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw;
    }
    return raw;
  }

  /**
   * Render a resolved config value for `show` output (PRD §9.7.10 masking).
   *
   * @remarks
   * Static + exported (via the class) so the secret-mask + undefined-to-empty
   * branches are unit-testable in isolation — {@link SCHEMA_MAP} has no
   * secret-suffixed keys, so the `<redacted>` path is defensive and is only
   * reachable through this helper directly.
   */
  static displayValue(key: string, value: HackConfigValue | undefined): string {
    if (isSecretKey(key)) return '<redacted>';
    return value === undefined ? '' : String(value);
  }

  // -------------------------------------------------------------------------
  // validate
  // -------------------------------------------------------------------------

  /**
   * `hack config validate [<file>]` — lint `.hack` + `.hack.local` (or an
   * explicit `<file>`). Exit 1 on secrets/type/range/parse hard errors, 0 on
   * warnings-only (CI-friendly). NEVER seeds `process.env` (pure lint — uses
   * {@link parseHackFile} + {@link validateHackTier} per file, NOT
   * {@link loadHackConfig}).
   */
  async #validateAction(
    _options: ConfigOptions,
    fileArg?: string
  ): Promise<void> {
    const files = fileArg
      ? [resolve(fileArg)]
      : [join(this.#repoRoot, '.hack'), join(this.#repoRoot, '.hack.local')];

    _resetValidationWarnings(); // fresh per-file warning dedup
    const errors: string[] = [];

    for (const file of files) {
      if (!existsSync(file)) {
        continue; // missing tier is not an error (§9.7.3)
      }
      try {
        const parsed = parseHackFile(file);
        validateHackTier(
          parsed,
          file,
          basename(file) === '.hack.local' ? 'project-local' : 'project'
        );
      } catch (e) {
        errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(chalk.red(e));
      }
      process.exit(1);
      return; // unreachable in production; guards test no-op exit fall-through
    }
    console.log(chalk.green('Configuration is valid.'));
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // path
  // -------------------------------------------------------------------------

  /**
   * `hack config path [--global|--local]` — print the resolved global / project
   * / local paths actually consulted (PRD §9.7.3). No flag = all three.
   */
  async #pathAction(options: ConfigOptions): Promise<void> {
    const globalP = globalHackPath();
    const projectP = join(this.#repoRoot, '.hack');
    const localP = join(this.#repoRoot, '.hack.local');

    interface PathRow {
      layer: string;
      path: string;
      exists: boolean;
    }
    let rows: PathRow[];

    if (options.global && !options.local) {
      rows = [{ layer: 'global', path: globalP, exists: existsSync(globalP) }];
    } else if (options.local && !options.global) {
      rows = [{ layer: 'local', path: localP, exists: existsSync(localP) }];
    } else {
      rows = [
        { layer: 'global', path: globalP, exists: existsSync(globalP) },
        { layer: 'project', path: projectP, exists: existsSync(projectP) },
        { layer: 'local', path: localP, exists: existsSync(localP) },
      ];
    }

    if (options.output === 'json') {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    for (const r of rows) {
      const marker = r.exists ? chalk.green('✓') : chalk.gray('✗');
      console.log(`${marker} ${chalk.cyan(r.layer.padEnd(13))} ${r.path}`);
    }
  }
}
