# Research — P2.M1.T1.S1: TOML parser dependency + parse/validate module

> Session 009, **PRD §9.7 (.hack Configuration File)** — the foundational parse
> module. Pure SYNC parse: read UTF-8 → reject BOM → `smol-toml.parse()` → rethrow
> parse errors with file path + line/col → return a typed `ParsedHackConfig`.
> Consumed by S2 (three-tier merge) and P2.M1.T2.S1 (secrets + type/range validation).

---

## 1. The dependency — smol-toml (verified API from node_modules)

`smol-toml@1.6.1` is **already in `node_modules`** as a **transitive** dep of
`markdownlint-cli` (package-lock.json: `~1.6.1`), but is **NOT** in `package.json`
`dependencies`. The contract + architecture (system_context §3.1-§3.2, §5; config doc §4)
mandate **promoting it to a direct `dependency`**: `"smol-toml": "^1.6.1"`.

### Verified exports (`node_modules/smol-toml/dist/index.d.ts`)
```ts
export { parse, stringify, TomlDate, TomlError };
export type { TomlValue, TomlTable, TomlValueWithoutBigInt, TomlTableWithoutBigInt };
```
- **`parse(toml: string, options?): TomlTableWithoutBigInt`** (`parse.d.ts`) — takes a
  TOML **string**, returns a plain nested object. TOML 1.0 compliant. `ParseOptions`
  has `maxDepth?` and `integersAsBigInt?` (we pass neither → numbers stay JS numbers).
  **Case-sensitive keys** (system_context §3.3 risk #3) — smol-toml does NOT lowercase;
  the lowercase-snake_case convention is a doc/authoring constraint, not enforced here.
- **`TomlError extends Error`** (`error.d.ts`) with **`line: number`**, **`column: number`**,
  `codeblock: string`. This is what smol-toml throws on malformed TOML AND duplicate keys.
  → S1 catches `TomlError`, reads `.line`/`.column`, rethrows with the file path.
- **ESM-native** (`"type": "module"`, exports `"import": "./dist/index.js"`). Import as
  `import { parse, TomlError } from 'smol-toml';` — no `.js` extension needed (it's a
  package, not a relative path; NodeNext resolves via the package `exports` map).
- **Does NOT handle BOM** (system_context §3.3 risk #3) — S1 must detect/reject it.

## 2. The module — `src/config/hack-config.ts` (SYNC parse, pure)

Contract signature: **`parseHackFile(filePath: string): ParsedHackConfig`** (NO Promise — sync).

```ts
import { readFileSync } from 'node:fs';
import { parse, TomlError } from 'smol-toml';

export type HackConfigValue = string | number | boolean;
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}

export function parseHackFile(filePath: string): ParsedHackConfig {
  try {
    const buffer = readFileSync(filePath);   // raw bytes (Buffer) for BOM check
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      throw new Error(`BOM detected in ${filePath}; remove it and re-save as UTF-8 without BOM`);
    }
    return parse(buffer.toString('utf8')) as unknown as ParsedHackConfig;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(
        `Failed to parse ${filePath}: ${error.message} (line ${error.line}, column ${error.column})`,
        { cause: error }
      );
    }
    throw error;   // BOM error / ENOENT / etc. — already carry the path; rethrow as-is
  }
}
```

### Design decisions (each de-risks one-pass success)
1. **BOM via first-3-bytes on a Buffer** (contract-literal "check first 3 bytes for
   0xEF 0xBB 0xBF"). Read raw bytes once (`readFileSync` with no encoding → Buffer),
   reject if the UTF-8 BOM signature is present, else `toString('utf8')`. Equivalent to
   reading `'utf8'` and checking `charCodeAt(0) === 0xFEFF`, but the byte check is
   unambiguous and matches the contract. (Either works; pick one — byte check used.)
2. **One try wraps read+BOM+parse.** The catch normalizes ONLY `TomlError` (adds file
   path + `line`/`column`, preserves original via `cause`). BOM errors and `readFileSync`
   ENOENT are NOT `TomlError` → rethrown as-is (they already name the path). This makes
   BOTH catch branches reachable for the **100%-coverage gate** (vitest.config.ts):
   if-branch = malformed-TOML test; else-branch = BOM test (and/or file-not-found test).
   Putting read INSIDE the try is what makes the else-branch coverable.
3. **Double cast `as unknown as ParsedHackConfig`** — `parse()` returns
   `TomlTableWithoutBigInt` (arbitrarily-nested `Record<string, TomlValue>`); the contract's
   `ParsedHackConfig` is exactly 2 levels of `string|number|boolean`. They are NOT
   structurally compatible, so a direct `as ParsedHackConfig` won't compile. The double cast
   is correct: S1 is the PARSE step; the actual value-TYPE/RANGE validation (§9.7.7 type
   mismatch) is **P2.M1.T2.S1**'s job. For valid `.hack` files the runtime shape already
   matches (sections → keys → string|int|bool).
4. **`cause: error`** on the rethrown parse error — preserves the original `TomlError`
   (with `line`/`column`/`codeblock`) for debugging while presenting a clean message.
   Node ≥16.9 / ES2022 `ErrorOptions` (project requires node ≥20, tsconfig target ES2022).
5. **Plain `Error`, no custom class** — the contract says "re-throw with file path + parser
   line/col", nothing about a structured error type. **P2.M1.T2.S1 explicitly owns "error
   semantics"** — it may introduce a `HackConfig*Error` hierarchy later. S1 stays minimal.

## 3. smol-toml behavior edge cases (verified by reading the lib + TOML 1.0 spec)
- `parse('')` → `{}`. `parse('# comment only\n')` → `{}`. Whitespace-only → `{}`. (empty
  `.hack` is valid → empty config; not an error.)
- TOML `#` line comments are ignored at parse time (§9.7.4). smol-toml handles this natively.
- Duplicate keys: smol-toml raises `TomlError` (§9.7.7 "duplicate key … surface the parser
  error verbatim with the file path"). S1's catch wraps it with the file path + line/col.
- Booleans: `true`/`false` → JS `boolean`. Integers → JS `number` (no bigint unless requested).
  Strings → JS `string`. Datetimes → `TomlDate` (NOT in the §9.7.5 schema; if one appears it
  would violate the `HackConfigValue` union — but that's a type/range validation concern for
  P2.M1.T2.S1, not S1's parse step).
- `[section]` tables → nested objects: `{ section: { key: value } }`. Exactly the
  `ParsedHackConfig` shape for valid files. No flattening needed.

## 4. SCOPE BOUNDARY (what S1 does NOT do — hard lines)
- **NOT three-tier discovery / layered merge / env-over-file seeding** → **S2**
  (P2.M1.T1.S2). S1's `parseHackFile` takes ONE absolute path and parses it; it does not
  discover `.hack`/`.hack.local`/global or merge layers.
- **NOT secrets refusal** (§9.7.6: refuse `[auth] *_key`/`*_token` in committable `.hack`)
  → **P2.M1.T2.S1**. S1 returns the raw parsed structure; the secrets scan operates on it.
- **NOT type/range validation or unknown-section/key warnings** (§9.7.7) → **P2.M1.T2.S1**.
  S1 only validates "is this parseable TOML + not BOM". Schema/key validation is downstream.
- **NOT bootstrap wiring** (the `.hack` load between `chdir` and `configureEnvironment()`,
  system_context §3.3) → later wiring milestone. S1 is a pure library function.
- **NO dependency on repo-root** (contract INPUT: "None — the parse function takes an
  absolute path"). Fully independent of P1.M1.T2.S1 (repo-root resolution).
- **NO `docs/*.md` / README** — Mode A = JSDoc only (on `parseHackFile` + the types).

## 5. package.json edit
Add `"smol-toml": "^1.6.1"` to `dependencies` (alphabetical: between `simple-git` and
`terser`). Current deps (14): chalk, cli-highlight, cli-progress, cli-table3, commander,
diff, fast-glob, groundswell, ms, pino, simple-git, **[smol-toml ← NEW]**, terser, tiktoken,
zod. Then run `npm install` to sync `package-lock.json` (smol-toml is already resolved at
1.6.1 in node_modules, so this just registers it as a DIRECT dependency — no download).

## 6. fs convention + test style (verified)
- **`readFileSync` from `node:fs`** is the dominant sync-read convention: `src/cli/index.ts:30`,
  `src/cli/commands/inspect.ts:20`, `src/core/file-lock.ts:55`, `src/scripts/validate-groundswell.ts:40`
  all use `node:fs` `readFileSync` (the one `from 'fs'` in `src/commands/process-code.command.ts`
  is older). Use `import { readFileSync } from 'node:fs';`.
- **Test style** (`tests/unit/config/constants.test.ts`): JSDoc file header +
  `import { describe, expect, it, afterEach, vi } from 'vitest';` + BDD
  `describe(...) { it('SHOULD …', () => { expect(...).toBe(...) }) }`. Pure & deterministic
  (no env mutation) to stay stable under the 100%-coverage gate.
- **Temp files**: the contract says "Test with real TOML strings and temp files." Use
  `mkdtempSync` (`node:fs`) + `tmpdir` (`node:os`) for a temp dir, `writeFileSync` real TOML,
  clean up in `afterEach`. For the BOM test, write the BOM bytes explicitly:
  `writeFileSync(p, Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]), Buffer.from('[harness]\nname="pi"\n')]))`.

## 7. The 100%-coverage gate — branch map for `parseHackFile`
| Branch | Trigger | Test |
|---|---|---|
| read success → no BOM → parse success → return | valid TOML file | "should parse a valid .hack into ParsedHackConfig" |
| BOM present → `throw new Error(BOM)` → catch else-branch → `throw error` | file with leading BOM bytes | "should reject a leading UTF-8 BOM with a clear error" |
| malformed TOML → `parse` throws `TomlError` → catch if-branch → transformed `throw new Error(file+line+col)` | file with broken TOML | "should rethrow parse errors with the file path and parser line/col" |
| duplicate key → `TomlError` → if-branch | file with dup key | "should surface duplicate-key errors with the file path" |
| (optional) file not found → `readFileSync` ENOENT → catch else-branch → `throw error` | nonexistent path | "should let a missing file propagate (ENOENT)" |
| empty/whitespace file → `parse('')` → `{}` | empty file | "should return an empty object for an empty/whitespace-only file" |
| comments-only file → `{}` | `# comment` file | "should ignore TOML comments" |

All branches coverable with real temp files → 100% on `src/config/hack-config.ts`.

## 8. Exact anchors
- `package.json` `dependencies` block (insert `"smol-toml": "^1.6.1"` between `simple-git` and `terser`).
- NEW `src/config/hack-config.ts` (the module — parseHackFile + HackConfigValue + ParsedHackConfig + Mode-A JSDoc).
- NEW `tests/unit/config/hack-config.test.ts` (BDD suite over real temp files).