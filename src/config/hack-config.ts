/**
 * `.hack` configuration file parser (PRD §9.7 — The `.hack` Configuration File).
 *
 * @module config/hack-config
 */

import { readFileSync } from 'node:fs';
import { parse, TomlError } from 'smol-toml';

/**
 * A scalar value in a parsed `.hack` file.
 *
 * @remarks
 * The §9.7.5 schema uses only strings, integers, and booleans (enums are strings;
 * ranges are validated downstream). Datetimes/arrays/nested-tables-as-values are NOT
 * part of the schema and are rejected by the type/range validation layer (P2.M1.T2.S1).
 */
export type HackConfigValue = string | number | boolean;

/**
 * The parsed shape of a `.hack` file: a map of TOML `[section]` tables, each a map of
 * lowercase-snake_case keys to scalar values.
 *
 * @remarks
 * TOML `[section]` headers map to top-level keys; `key = value` pairs within a section
 * map to that section's nested object. For a valid `.hack` this is exactly the structure
 * `smol-toml.parse()` returns. All keys are lowercase snake_case within their section
 * (§9.7.4); `smol-toml` is case-sensitive, so the casing is an authoring convention
 * enforced by validation/docs, not transformed here.
 */
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}

/**
 * Read and parse a `.hack` (TOML 1.0) configuration file into a typed
 * {@link ParsedHackConfig}.
 *
 * @remarks
 * **Format (PRD §9.7.4):** TOML 1.0, parsed via `smol-toml` (the project's TOML
 * dependency). UTF-8 encoding; a leading byte-order mark is REJECTED with a clear
 * error (`smol-toml` does not handle BOM, so this loader detects it manually by
 * checking the first 3 bytes for `0xEF 0xBB 0xBF`). Comments (`#`) are ignored at
 * parse time. All keys are lowercase snake_case within their section.
 *
 * **Errors (PRD §9.7.7):**
 * - **BOM:** throws an `Error` naming the file and the UTF-8-without-BOM remediation.
 * - **Malformed TOML / duplicate key:** `smol-toml` raises a `TomlError` (with `.line`
 *   and `.column`); this function rethrows an `Error` naming the file and the parser's
 *   line/column (the original `TomlError` is preserved on `error.cause`).
 * - **Missing file:** the `readFileSync` `ENOENT` propagates (it already names the path).
 *
 * This is the PARSE step only. Three-tier discovery/merge (S2), secrets refusal
 * (§9.7.6), and type/range/unknown-key validation (§9.7.7) are downstream layers.
 *
 * SYNC — takes an absolute path; no discovery, no `process.env` mutation, no I/O beyond
 * the single file read.
 *
 * @param filePath - Absolute path to a `.hack` / `.hack.local` TOML file.
 * @returns The parsed config: `{ [section]: { [key]: string|number|boolean } }`.
 * @throws {Error} on BOM or malformed TOML (message names the file + line/column).
 *
 * @example
 * ```ts
 * import { parseHackFile } from './config/hack-config.js';
 *
 * const cfg = parseHackFile('/repo/.hack');
 * // cfg.harness.name === 'pi'; cfg.pipeline.research_depth === 3
 * ```
 */
export function parseHackFile(filePath: string): ParsedHackConfig {
  try {
    const buffer = readFileSync(filePath); // raw bytes — for the BOM signature check
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    ) {
      throw new Error(
        `BOM detected in ${filePath}; remove it and re-save as UTF-8 without BOM`
      );
    }
    return parse(buffer.toString('utf8')) as unknown as ParsedHackConfig;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(
        `Failed to parse ${filePath}: ${error.message} (line ${error.line}, column ${error.column})`,
        { cause: error }
      );
    }
    throw error; // BOM Error / ENOENT / etc. — already carry the path; rethrow as-is
  }
}
