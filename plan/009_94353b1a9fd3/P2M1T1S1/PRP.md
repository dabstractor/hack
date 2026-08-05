# PRP — P2.M1.T1.S1: TOML parser dependency + parse/validate module

---

## Goal

**Feature Goal**: Build the foundational `.hack` config **parse** module (PRD §9.7.4
Format). Promote the already-installed `smol-toml@1.6.1` (currently only a transitive
dep of `markdownlint-cli`) to a **direct `package.json` dependency**, and create
`src/config/hack-config.ts` exporting a pure SYNC `parseHackFile(filePath)` that reads
a file as UTF-8, **rejects a leading UTF-8 BOM** with a clear error, parses it via
`smol-toml.parse()`, **rethrows parse errors with the file path + parser line/column**,
and returns a typed `ParsedHackConfig` (`{ [section]: { [key]: string|number|boolean } }`).
This is the **parse-only** foundation — it does NOT do three-tier merge (S2), secrets
refusal (P2.M1.T2.S1), or type/range validation (P2.M1.T2.S1).

**Deliverable**:
1. **`package.json`** — EDIT `dependencies`: add `"smol-toml": "^1.6.1"` (alphabetical,
   between `simple-git` and `terser`); run `npm install` to sync the lockfile.
2. **`src/config/hack-config.ts`** — CREATE: `HackConfigValue` union, `ParsedHackConfig`
   type, `parseHackFile(filePath: string): ParsedHackConfig` (sync), and Mode-A JSDoc.
3. **`tests/unit/config/hack-config.test.ts`** — CREATE: BDD suite over **real TOML temp
   files** (valid parse, BOM rejection, parse-error rethrow w/ line+col, duplicate key,
   empty/whitespace, comments-ignored, file-not-found) — pure & deterministic.

**Success Definition**:
- `parseHackFile('/abs/path/.hack')` on a valid TOML file returns a `ParsedHackConfig`
  whose sections → keys → values preserve TOML types (string/number/boolean).
- A file with a leading UTF-8 BOM (bytes `EF BB BF`) throws an `Error` whose message names
  the file and says "BOM" + the re-save remediation.
- A malformed-TOML file throws an `Error` whose message names the file AND includes the
  parser's `line`/`column` (rethrown from `smol-toml`'s `TomlError`).
- A duplicate-key file throws (smol-toml raises `TomlError`; S1 wraps with the file path).
- An empty / whitespace-only / comments-only file returns `{}` (NOT an error).
- `npm install` reconciles `package-lock.json` (smol-toml registered as a DIRECT dep).
- `npm run typecheck && npm run lint && npm run format:check` clean; `npx vitest run
  tests/unit/config/hack-config.test.ts` GREEN with **100% coverage** on
  `src/config/hack-config.ts`.
- S1 edits ONLY `package.json` + creates `src/config/hack-config.ts` + its test. No
  discovery/merge/secrets/validation/bootstrap wiring (those are S2 / P2.M1.T2.S1 / later).

---

## Why

- **Foundational for all of P2.M1.** §9.7.4 mandates TOML 1.0 parsing via `smol-toml`.
  S2 (three-tier discovery + layered merge + env-over-file seeding) calls `parseHackFile`
  on each discovered `.hack`/`.hack.local`/global file; P2.M1.T2.S1 (secrets refusal +
  type/range validation) operates on the `ParsedHackConfig` S1 returns. S1 is the
  contract output they both consume.
- **The parser must be a direct dependency.** `smol-toml@1.6.1` is in `node_modules` only
  transitively (via `markdownlint-cli`, a devDep). Relying on a transitive dep is fragile
  (a `markdownlint-cli` upgrade/removal would silently break the config loader).
  Promoting it makes the dependency explicit and auditable (system_context §3.1, §5).
- **BOM + parse-error UX.** §9.7.4 requires rejecting a leading BOM "with a clear error";
  §9.7.7 requires a malformed-TOML parse error to name "the file and the parser's
  line/column". `smol-toml` does neither (no BOM handling; its `TomlError` lacks the file
  path) — S1 wraps both into actionable, file-attributed errors.
- **Out of scope (hard boundaries):** three-tier discovery/merge/env-seeding (S2),
  secrets policy §9.7.6 (P2.M1.T2.S1), type/range/unknown-key validation §9.7.7
  (P2.M1.T2.S1), the `hack config` subcommand §9.7.8 (P2.M2.T2), `.gitignore` management
  (P2.M2.T3), bootstrap wiring between `chdir` and `configureEnvironment()` (system_context
  §3.3 — later milestone), repo-root resolution (P1 — independent; S1 takes an absolute
  path), and any `docs/*.md` (Mode A = JSDoc only).

---

## What

### User-visible behavior
None directly — `parseHackFile` is a library function consumed by the `.hack` loader (S2).
Indirectly: once wired, a `.hack` with a BOM or malformed TOML produces a clear, file-
attributed startup error instead of a cryptic deep failure.

### Technical requirements (exact contract)

**`package.json`** — EDIT `dependencies` (add one line, alphabetical):
```jsonc
    "simple-git": "^3.30.0",
    "smol-toml": "^1.6.1",     // ← NEW (was only transitive via markdownlint-cli)
    "terser": "^5.46.0",
```
Then run `npm install` (syncs `package-lock.json` — registers smol-toml as a direct dep;
it is already resolved at 1.6.1 in `node_modules`, so no download).

**`src/config/hack-config.ts`** — CREATE:
```ts
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
```

### Success Criteria
- [ ] `package.json` `dependencies` contains `"smol-toml": "^1.6.1"`; `npm install` run;
      `package-lock.json` lists smol-toml under the root package's dependencies.
- [ ] `src/config/hack-config.ts` exports `parseHackFile`, `ParsedHackConfig`, `HackConfigValue`.
- [ ] `parseHackFile` is SYNC (`: ParsedHackConfig`, not `Promise<…>`).
- [ ] Valid TOML → `ParsedHackConfig` with preserved types (string/number/boolean).
- [ ] BOM file → throws `Error` whose message contains the file path and "BOM".
- [ ] Malformed TOML → throws `Error` whose message contains the file path, "line", "column".
- [ ] Duplicate key → throws (wrapped `TomlError` with file path).
- [ ] Empty / whitespace-only / comments-only file → returns `{}`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` GREEN with 100% coverage on the new module.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_
**Yes.** The verbatim module source is given (§"Technical requirements"). The smol-toml
API is verified from its bundled `.d.ts` (`parse(string)→object`; `TomlError` with
`.line`/`.column`; ESM `import { parse, TomlError } from 'smol-toml'`; no BOM handling).
The dependency fact is proven (transitive via markdownlint-cli, not in package.json —
must promote). The `node:fs` `readFileSync` convention is confirmed (5 call sites). The
double-cast rationale (`TomlTableWithoutBigInt` ≠ `ParsedHackConfig` structurally) is
explained. The 100%-coverage branch map is enumerated (research §7) so every branch has a
test. The scope boundary (parse-only; merge/secrets/validation are S2/P2.M1.T2.S1) is
explicit. And the test recipe (real temp files via `mkdtempSync` + BOM bytes via `Buffer`)
is spelled out.

### Documentation & References
```yaml
# MUST READ — the PRD spec this implements
- docfile: PRD.md
  section: "9.7.4 Format" (h4.22)
  why: TOML 1.0 via smol-toml; UTF-8; BOM rejected with a clear error; comments ignored at parse time;
        all keys lowercase snake_case within their section. THIS is the parse contract.
- docfile: PRD.md
  section: "9.7.7 Validation & Error Handling" (h4.25)
  why: "Parse error (malformed TOML): hard error naming the file and the parser's line/column; abort."
        + "Duplicate key: TOML rejects; surface the parser error verbatim with the file path." ← S1's error contract.
        (Unknown-section/key + type/range are P2.M1.T2.S1, NOT S1.)
- docfile: PRD.md
  section: "9.7.5 Schema Reference" (h4.23)
  why: Confirms value types are ONLY string/int/bool/enums → justifies HackConfigValue = string|number|boolean.
        Also the example .hack (harness/models/pipeline/validation/...) the tests should mirror.

# MUST READ — this subtask's research (verbatim module + API + branch map + scope)
- docfile: plan/009_94353b1a9fd3/P2M1T1S1/research/toml-parser-module-design.md
  section: "1. The dependency", "2. The module", "3. smol-toml behavior edge cases",
           "4. SCOPE BOUNDARY", "7. The 100%-coverage gate — branch map"
  why: Verified smol-toml exports + TomlError.line/column; the BOM-via-first-3-bytes decision; WHY one try wraps
        read+BOM+parse (else-branch coverability); WHY the double cast; the parse-only vs validate boundary.

# MUST READ — architecture (dependency + parser choice + bootstrap ordering)
- docfile: plan/009_94353b1a9fd3/architecture/system_context.md
  section: "3.1 No App-Level Config File", "3.2 TOML Parser Choice", "3.3 Config System Architecture"
  why: Confirms smol-toml is transitive (must promote); smol-toml API `import { parse, stringify } from 'smol-toml'`;
        case-sensitive keys; no BOM handling (loader must detect/reject). NOTE: bootstrap WIRING (insert between
        chdir and configureEnvironment) is a LATER milestone — S1 is just the library function, no wiring.
- docfile: plan/009_94353b1a9fd3/architecture/config-system-and-constants.md
  section: "4. Dependencies — TOML Parser"
  why: Re-confirms: NO TOML parser in package.json deps; smol-toml@1.6.1 transitive via markdownlint-cli;
        must promote to a direct dependency. Lists the 14 current runtime deps (insert smol-toml alphabetically).

# THE DEPENDENCY — verified API (read these from node_modules to confirm)
- file: node_modules/smol-toml/dist/index.d.ts
  why: Exports: parse, stringify, TomlDate, TomlError; types TomlValue/TomlTable. ESM import path 'smol-toml'.
- file: node_modules/smol-toml/dist/parse.d.ts
  why: `parse(toml: string, options?): TomlTableWithoutBigInt` — takes a STRING, returns a nested object. ParseOptions
        has maxDepth?/integersAsBigInt? (we pass neither → numbers stay JS numbers).
- file: node_modules/smol-toml/dist/error.d.ts
  why: `class TomlError extends Error { line: number; column: number; codeblock: string }` — what smol-toml throws on
        malformed TOML + duplicate keys. S1 reads .line/.column for the rethrown message.

# PATTERN FILES — fs convention + test style
- file: src/cli/index.ts
  why: `import { readFileSync } from 'node:fs';` (line 30) + `readFileSync(path, 'utf8')` (line 315) — the dominant
        sync-read convention. Mirror `node:fs` (NOT the older `from 'fs'` in process-code.command.ts).
  pattern: "import { readFileSync } from 'node:fs';"
- file: src/core/file-lock.ts
  why: `readFileSync(lockPath, 'utf8')` (line 207) — another sync-read precedent. Confirms readFileSync is idiomatic here.
- file: tests/unit/config/constants.test.ts
  why: The BDD style to MIRROR for hack-config.test.ts: JSDoc file header + `import { describe, expect, it, afterEach } from 'vitest';`
        + describe/it/expect. Pure & deterministic (no env mutation) for the 100%-coverage gate.
  pattern: "describe('MODEL_NAMES', () => { it('SHOULD ...', () => { expect(X).toBe(Y) }) })"

# CONTRACT — siblings (do NOT duplicate; S1 is consumed by them)
- docfile: plan/009_94353b1a9fd3/tasks.json (P2.M1.T1.S2 / P2.M1.T2.S1 titles)
  why: S2 = three-tier discovery/merge/env-seeding (calls parseHackFile per file); P2.M1.T2.S1 = secrets refusal +
        type/range validation + error semantics. S1 returns the raw ParsedHackConfig they layer on top. Do NOT
        implement discovery/merge/secrets/validation here.
```

### Current Codebase tree (relevant slice)
```bash
package.json                      # EDIT — +1 dependency line ("smol-toml": "^1.6.1")
src/config/
├── constants.ts                  # existing (pattern reference, not edited)
├── hack-config.ts                # NEW — parseHackFile + ParsedHackConfig + HackConfigValue + JSDoc
├── environment.ts                # existing (not edited)
├── harness.ts / types.ts / endpoint-guard.ts   # existing (not edited)
tests/unit/config/
├── constants.test.ts             # existing (BDD-style pattern reference)
└── hack-config.test.ts           # NEW — BDD suite over real TOML temp files
node_modules/smol-toml/           # ALREADY INSTALLED (transitive); index.d.ts/parse.d.ts/error.d.ts verified
```

### Desired Codebase tree with files to be added/edited
```bash
package.json                      # MODIFIED (+smol-toml dep; npm install syncs lockfile)
src/config/hack-config.ts         # NEW (parseHackFile + types + Mode-A JSDoc)
tests/unit/config/hack-config.test.ts   # NEW (BDD: valid/BOM/malformed/dup/empty/comments/ENOENT)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — smol-toml is currently ONLY a transitive dep (via markdownlint-cli). It MUST be added to package.json
//   dependencies as "smol-toml": "^1.6.1" and `npm install` run, or a markdownlint-cli change could remove it.

// CRITICAL — smol-toml does NOT handle BOM. Detect it manually: readFileSync (no encoding → Buffer), check the first
//   3 bytes for 0xEF 0xBB 0xBF, REJECT (throw) — do NOT strip+continue (§9.7.4 says "rejected with a clear error").
//   Guard with `buffer.length >= 3 &&` so a short/empty file doesn't misfire.

// CRITICAL — the cast is `as unknown as ParsedHackConfig` (DOUBLE cast). smol-toml's parse() returns
//   TomlTableWithoutBigInt (arbitrarily-nested Record<string, TomlValue>); ParsedHackConfig is exactly 2 levels of
//   string|number|boolean. They are NOT structurally compatible → a single `as ParsedHackConfig` will NOT compile.
//   The double cast is correct: S1 is parse-only; value-TYPE/RANGE validation is P2.M1.T2.S1.

// CRITICAL — ONE try wraps read+BOM+parse so BOTH catch branches are coverable under the 100%-coverage gate:
//   if-branch (TomlError → wrapped rethrow) ← malformed-TOML test; else-branch (throw error as-is) ← BOM test
//   (and ENOENT test). If read/BOM were OUTSIDE the try, the else-branch would be dead code → coverage failure.

// GOTCHA — import { parse, TomlError } from 'smol-toml' — NO '.js' extension (it's a package, resolved via its
//   `exports` map, not a relative path). NodeNext requires extensions on RELATIVE imports only.

// GOTCHA — parseHackFile is SYNC (: ParsedHackConfig, NOT Promise). Use readFileSync (node:fs), NOT fs/promises.
//   The contract signature is sync; the loader (S2) calls it synchronously during bootstrap.

// GOTCHA — smol-toml key names are CASE-SENSITIVE. §9.7.4 says keys are lowercase snake_case, but that's an
//   authoring/doc convention — S1 does NOT transform casing (it returns what's written). Enforcing casing is a
//   validation concern (P2.M1.T2.S1), NOT S1's parse step.

// GOTCHA — empty/whitespace/comments-only TOML parses to {} (NOT an error). Don't throw on empty .hack.
//   smol-toml: parse('') → {}; parse('# c\n') → {}.

// GOTCHA — duplicate keys: smol-toml raises TomlError (§9.7.7 "TOML rejects duplicate keys"). S1's catch wraps it
//   with the file path + line/col (same path as malformed TOML). One malformed-TOML test + one dup-key test both
//   exercise the if-branch; that's fine (coverage counts branch execution, not uniqueness).

// GOTCHA — `new Error(msg, { cause: error })` requires Node ≥16.9 / ES2022 lib. Project requires node ≥20 and
//   tsconfig target ES2022 — supported. `cause` preserves the original TomlError (line/column/codeblock) for debug.

// GOTCHA — prettier is ERROR-enforced (format:check). The BOM byte literals (0xef vs 0xEF) — prettier/eslint may
//   prefer lowercase hex; run `npm run fix` to normalize. Run it before `npm run validate`.

// CRITICAL — 100% coverage is globally enforced (vitest.config.ts: statements/branches/functions/lines all 100,
//   include src/**/*.ts). The new hack-config.ts MUST hit 100%. The branch map (research §7) ensures every branch
//   (BOM-throw, TomlError-if, else-rethrow, parse-success, empty→{}) has a test.
```

---

## Implementation Blueprint

### Data models and structure
```ts
export type HackConfigValue = string | number | boolean;
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}
```
No ORM/pydantic — plain TS types. `ParsedHackConfig` matches the structure `smol-toml`
emits for valid `.hack` files (section → key → scalar). The double cast bridges the
library's broader `TomlTable` type to this precise contract.

### Implementation Tasks (ordered by dependencies)
```yaml
Task 1: EDIT package.json — promote smol-toml to a direct dependency
  - ADD to the `dependencies` object (alphabetical, between "simple-git" and "terser"):
        "smol-toml": "^1.6.1",
  - RUN: npm install   (syncs package-lock.json; smol-toml is already in node_modules at 1.6.1, so this just
        registers it under the root package's dependencies — no download, fast).
  - VERIFY: rg -n '"smol-toml"' package.json package-lock.json   (package.json has it; lockfile root deps now list it).
  - DO NOT touch devDependencies, scripts, or any other field.
  - EXPECTED: npm install exits 0; package-lock.json updated; node_modules/smol-toml unchanged (already 1.6.1).

Task 2: CREATE src/config/hack-config.ts (the parse module)
  - CREATE the file with the VERBATIM content in "Technical requirements" (imports, HackConfigValue,
    ParsedHackConfig, parseHackFile, Mode-A JSDoc).
  - KEY DETAILS: `import { readFileSync } from 'node:fs';` + `import { parse, TomlError } from 'smol-toml';`.
    readFileSync (no encoding → Buffer) → first-3-bytes BOM check → toString('utf8') → parse() → double cast.
    ONE try around read+BOM+parse; catch normalizes TomlError (file path + line + column + cause), else rethrows.
  - DO NOT add discovery/merge/secrets/validation/env-mutation — those are S2 / P2.M1.T2.S1.
  - EXPECTED: npm run typecheck clean (double cast compiles; TomlError imported correctly).

Task 3: CREATE tests/unit/config/hack-config.test.ts (BDD suite over real temp files)
  - HEADER: JSDoc + `import { describe, expect, it, afterEach, beforeAll } from 'vitest';`
  - FIXTURES: a temp dir via `mkdtempSync(join(tmpdir(), 'hack-config-'))` (node:fs + node:os) in beforeAll;
    `writeFileSync` real TOML files; `rmSync(dir, { recursive: true, force: true })` in afterEach/afterAll.
  - IMPORT under test: `import { parseHackFile, type ParsedHackConfig } from '../../../src/config/hack-config.js';`
  - CASES (mirror constants.test.ts BDD style; cover the research §7 branch map):
      * 'SHOULD parse a valid .hack into a ParsedHackConfig preserving types':
          write `[harness]\nname = "pi"\n[pipeline]\nresearch_depth = 3\nparallel_research = true\n`;
          const cfg = parseHackFile(path);
          expect(cfg.harness.name).toBe('pi');            // string
          expect(cfg.pipeline.research_depth).toBe(3);    // number
          expect(cfg.pipeline.parallel_research).toBe(true); // boolean
      * 'SHOULD reject a leading UTF-8 BOM with a clear error naming the file':
          write `Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]), Buffer.from('[harness]\nname="pi"\n')])`;
          expect(() => parseHackFile(path)).toThrow(/BOM/); expect(() => parseHackFile(path)).toThrow(path);
      * 'SHOULD rethrow parse errors with the file path and parser line/column':
          write `[harness\nname = "pi"` (unterminated table header — malformed);
          expect(() => parseHackFile(path)).toThrow(path); expect(() => parseHackFile(path)).toThrow(/line/i);
      * 'SHOULD surface duplicate-key errors with the file path':
          write `[harness]\nname = "pi"\nname = "claude-code"\n`;
          expect(() => parseHackFile(path)).toThrow(path);   // smol-toml raises TomlError; S1 wraps w/ path
      * 'SHOULD return an empty object for an empty/whitespace-only file':
          write `` (empty) and `   \n  ` (whitespace); expect(parseHackFile(p)).toEqual({});
      * 'SHOULD ignore TOML comments':
          write `# a comment\n[harness]\nname = "pi" # inline\n`; expect(cfg.harness.name).toBe('pi');
      * 'SHOULD let a missing file propagate (ENOENT)':
          expect(() => parseHackFile(join(dir, 'nope.hack'))).toThrow(/ENOENT/);  // exercises catch else-branch
  - NAMING: describe('parseHackFile'); it('SHOULD …'). PLACEMENT: tests/unit/config/hack-config.test.ts.
  - GOTCHA: write the BOM test's bytes via Buffer (not a string — a JS string can't carry raw 0xEF 0xBB 0xBF
        reliably through writeFileSync's default utf8). Use Buffer.concat as shown.
  - EXPECTED: GREEN with 100% coverage on src/config/hack-config.ts (every branch hit — see research §7).

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.  (MUST be clean.)
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts --coverage
        (EXPECTED: GREEN; 100% on src/config/hack-config.ts. If a branch is uncovered, add the matching case
        from the branch map — most likely the else-rethrow if you didn't add the BOM or ENOENT test.)
  - RUN: rg -n '"smol-toml"' package.json   (EXPECTED: the new dep line).
  - DO NOT run the full `npm run test:run` unless desired — it may include unrelated pre-existing red suites
        from other in-flight plan-009 work; S1's gate is the targeted file + typecheck/lint/format.
  - EXPECTED: all clean; smol-toml in deps; new module + test GREEN at 100%.
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/hack-config.ts: the parse function (SYNC, pure, one file read) ----
import { readFileSync } from 'node:fs';
import { parse, TomlError } from 'smol-toml';

export type HackConfigValue = string | number | boolean;
export interface ParsedHackConfig {
  [section: string]: { [key: string]: HackConfigValue };
}

export function parseHackFile(filePath: string): ParsedHackConfig {
  try {
    const buffer = readFileSync(filePath);                  // raw bytes for the BOM check
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      throw new Error(`BOM detected in ${filePath}; remove it and re-save as UTF-8 without BOM`);
    }
    return parse(buffer.toString('utf8')) as unknown as ParsedHackConfig;   // double cast (see Gotchas)
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(
        `Failed to parse ${filePath}: ${error.message} (line ${error.line}, column ${error.column})`,
        { cause: error }
      );
    }
    throw error;                                            // BOM Error / ENOENT — rethrown as-is
  }
}

// ---- tests/unit/config/hack-config.test.ts: BOM test must write raw bytes via Buffer ----
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// ...
writeFileSync(
  bomPath,
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[harness]\nname = "pi"\n')])
);
expect(() => parseHackFile(bomPath)).toThrow(/BOM/);
```

### Integration Points
```yaml
DEPENDENCY (package.json):
  - ADD "smol-toml": "^1.6.1" to dependencies (alphabetical, simple-git → smol-toml → terser).
  - RUN npm install (syncs package-lock.json; no download — already in node_modules at 1.6.1).

MODULE (src/config/hack-config.ts):
  - EXPORT parseHackFile(filePath: string): ParsedHackConfig  (SYNC; takes an absolute path).
  - EXPORT type HackConfigValue = string | number | boolean.
  - EXPORT interface ParsedHackConfig { [section]: { [key]: HackConfigValue } }.
  - BOM: reject (throw) first-3-bytes 0xEF 0xBB 0xBF. PARSE ERROR: rethrow w/ file path + TomlError.line/.column.

NO WIRING (hard boundary):
  - NO bootstrap insertion (the .hack load between chdir and configureEnvironment is a LATER milestone — S1 is a lib fn).
  - NO discovery/merge/env-seeding (S2), NO secrets refusal (P2.M1.T2.S1), NO type/range/unknown-key validation
    (P2.M1.T2.S1), NO hack config subcommand (P2.M2.T2), NO .gitignore management (P2.M2.T3).
  - NO process.env mutation, NO repo-root dependency (takes an absolute path), NO docs/*.md (Mode A = JSDoc).

DOWNSTREAM CONSUMERS (S1's output is their input — do not break the contract):
  - S2 (three-tier discovery/merge) calls parseHackFile per discovered file, then merges.
  - P2.M1.T2.S1 (secrets + validation) scans the returned ParsedHackConfig for [auth] *_key/*_token and validates types/ranges.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm install            # sync package-lock.json after the package.json dep add (fast — already in node_modules)
npm run fix            # lint:fix + prettier --write (normalizes 0xEF→0xef hex casing etc.)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — MUST be clean (double cast + ESM import compile)
npm run lint           # eslint . --ext .ts
npm run format:check   # prettier --check
# Targeted:
npx eslint src/config/hack-config.ts
npx prettier --check src/config/hack-config.ts
# Expected: all clean. Likely failures: (a) typecheck error if you used a single `as ParsedHackConfig` (the types are
#   structurally incompatible) — use the double cast `as unknown as ParsedHackConfig`; (b) a prettier hex-casing nit
#   on the BOM bytes — `npm run fix` normalizes it.
```

### Level 2: Unit Tests (Component Validation)
```bash
npx vitest run tests/unit/config/hack-config.test.ts --coverage
# Expected: GREEN with 100% coverage on src/config/hack-config.ts. If coverage < 100%, a branch is unexercised —
#   consult the branch map (research §7): BOM-throw & else-rethrow need the BOM + ENOENT tests; TomlError-if needs
#   the malformed/dup-key tests; empty→{} needs the empty-file test.
# Spot-check the dependency registration:
rg -n '"smol-toml"' package.json package-lock.json   # package.json dep line present; lockfile root deps updated.
```

### Level 3: Integration / Regression (System Validation)
```bash
# S1 is a pure library fn — no service to start. Confirm scope discipline:
git status --short src/config/      # Expect: NEW src/config/hack-config.ts only (no edits to constants/environment/harness/types).
git status --short package.json     # Expect: M package.json (the one dep line).
# Confirm no downstream surface was touched (S1 is parse-only; no wiring):
rg -n "parseHackFile|hack-config" src/ | grep -v "src/config/hack-config.ts"   # Expect: EMPTY (no caller wired yet — that's S2).
# Confirm smol-toml resolves at runtime from a direct import (proves the dep promotion worked):
node --input-type=module -e "import('smol-toml').then(m => console.log('smol-toml parse:', typeof m.parse, '| TomlError:', typeof m.TomlError))"
# Expected: 'smol-toml parse: function | TomlError: function'. (Confirms the package resolves as a direct dependency.)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. Round-trip a real .hack — parse the §9.7.5 example (harness/models/pipeline/validation/distributed_prd/cli):
node --input-type=module -e "
import('./dist/config/hack-config.js').then(async ({ parseHackFile }) => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(),'hc-'));
  const p = join(d,'.hack');
  writeFileSync(p, '[harness]\nname=\"pi\"\n[models]\nbalanced=\"glm-5.2\"\n[pipeline]\nresearch_depth=3\nparallel_research=true\n');
  const cfg = parseHackFile(p);
  console.log('harness.name:', cfg.harness.name, '| models.balanced:', cfg.models.balanced,
              '| pipeline.research_depth:', cfg.pipeline.research_depth, '(number)', '| parallel_research:', cfg.pipeline.parallel_research, '(bool)');
  rmSync(d,{recursive:true,force:true});
});"   # (run `npm run build` first; Expected: harness.name: pi | models.balanced: glm-5.2 | research_depth: 3 (number) | parallel_research: true (bool))
#   2. BOM rejection + malformed-TOML line/col — covered by the unit suite (Tasks above); cite the GREEN tests.
#   3. Types preserved — string/number/boolean come back as JS primitives (not stringified). Proven by the
#      'preserving types' it() asserting .toBe(3) (number) and .toBe(true) (boolean).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm install` exits 0; `package-lock.json` updated; `"smol-toml": "^1.6.1"` in package.json `dependencies`.
- [ ] `npm run typecheck` clean (double cast compiles; `import { parse, TomlError } from 'smol-toml'` resolves).
- [ ] `npm run lint` clean; `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts --coverage` GREEN with 100% on `src/config/hack-config.ts`.
- [ ] `git status --short src/config/` shows ONLY the new `hack-config.ts`; no other config file edited.

### Feature Validation
- [ ] Valid TOML → `ParsedHackConfig` with preserved types (string/number/boolean).
- [ ] BOM file → throws `Error` naming the file + "BOM".
- [ ] Malformed TOML → throws `Error` naming the file + line + column.
- [ ] Duplicate key → throws (wrapped, with file path).
- [ ] Empty / whitespace-only / comments-only file → returns `{}`.
- [ ] `parseHackFile` is SYNC; takes an absolute path; does ONE file read; no env mutation.

### Code Quality Validation
- [ ] `node:fs` `readFileSync` used (matches the src/cli + src/core convention; NOT the older `from 'fs'`).
- [ ] Double cast `as unknown as ParsedHackConfig` (not a single `as` — the types are structurally incompatible).
- [ ] ONE try wraps read+BOM+parse (so both catch branches are coverable for the 100%-coverage gate).
- [ ] Mode-A JSDoc on `parseHackFile` documents format (TOML 1.0/UTF-8/BOM-reject), key casing, return type, smol-toml.
- [ ] No discovery/merge/secrets/validation/wiring (those are S2 / P2.M1.T2.S1 / later milestones).

### Documentation & Deployment
- [ ] Mode-A JSDoc is the only doc artifact (rides with the code).
- [ ] No `docs/*.md`, README, `.env.example`, or bootstrap (`src/index.ts`/`main()`) changes.
- [ ] Commit message notes: smol-toml promoted from transitive to direct dep; the parse-only scope (S2/P2.M1.T2.S1
      own the rest); BOM + parse-error UX (file path + line/col); the double-cast + one-try coverage rationale.

---

## Anti-Patterns to Avoid

- ❌ Don't rely on smol-toml staying as a transitive dep — ADD it to package.json `dependencies` + `npm install`.
      A markdownlint-cli change could otherwise remove it and silently break the loader.
- ❌ Don't strip the BOM and continue — §9.7.4 says "rejected with a clear error". THROW (name the file + remediation).
- ❌ Don't use a single `as ParsedHackConfig` — `TomlTableWithoutBigInt` and `ParsedHackConfig` are structurally
      incompatible; it won't compile. Use the DOUBLE cast `as unknown as ParsedHackConfig`.
- ❌ Don't put read/BOM OUTSIDE the try — the catch's else-branch (`throw error` for non-TomlError) would become dead
      code and FAIL the 100%-coverage gate. One try wraps read+BOM+parse so BOM/ENOENT cover the else-branch.
- ❌ Don't make `parseHackFile` async or use `fs/promises` — the contract signature is SYNC (`: ParsedHackConfig`).
      Use `readFileSync` from `node:fs`.
- ❌ Don't add a `.js` extension to the `smol-toml` import — it's a package (resolved via its `exports` map), not a
      relative path. NodeNext extensions are for RELATIVE imports only (the test's `../../../src/...js` import DOES
      need `.js`).
- ❌ Don't implement discovery/merge/secrets/type-validation/bootstrap-wiring — those are S2 / P2.M1.T2.S1 / later.
      S1 is the PARSE step only (one file → ParsedHackConfig). Scope creep here causes merge conflicts downstream.
- ❌ Don't transform key casing — smol-toml is case-sensitive; lowercase-snake_case is an authoring convention
      enforced by validation/docs (P2.M1.T2.S1), not by S1's parse step.
- ❌ Don't throw on an empty `.hack` — `parse('')` → `{}` is correct (empty config, not an error).
- ❌ Don't stringify values — return JS primitives (smol-toml preserves TOML types: string/number/boolean). The
      'preserving types' test asserts `.toBe(3)` (number) and `.toBe(true)` (boolean), not strings.
- ❌ Don't write the BOM test's bytes as a JS string — use `Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), ...])` so
      the raw BOM bytes hit disk (a utf8 string would re-encode them).
- ❌ Don't edit `constants.ts`/`environment.ts`/`harness.ts`/`types.ts` or wire `parseHackFile` into `main()`/bootstrap
      — S1 is a standalone library module. The wiring is a later milestone; the merge is S2.
- ❌ Don't edit any `docs/*.md` — Mode A is JSDoc only.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, self-contained, pure module with every fact empirically
verified. The smol-toml API is read from its bundled `.d.ts` (`parse(string)→object`;
`TomlError.line/.column`; ESM import; no BOM handling). The dependency fact is proven
(transitive via markdownlint-cli; must promote — confirmed in two architecture docs). The
verbatim module source is given, including the two non-obvious decisions that de-risk it:
the **double cast** (the library's `TomlTable` type ≠ the contract's `ParsedHackConfig`,
so a single `as` won't compile) and the **one-try-wraps-read+BOM+parse** structure (so
the catch's else-branch is coverable under the project's mandatory 100%-coverage gate).
The fs convention (`node:fs` `readFileSync`) and the BDD test style (`constants.test.ts`)
are confirmed in-repo. The scope boundary is crisp — S1 is parse-only; three-tier merge
(S2), secrets refusal + type/range validation (P2.M1.T2.S1), and bootstrap wiring (later)
are explicitly fenced so the executor doesn't scope-creep into a downstream conflict. The
branch map (research §7) gives a 1:1 test→branch mapping so 100% coverage is achievable
on the first pass. Residual risks are mechanical and gate-caught: (a) a single-`as`
typecheck error (fix = double cast); (b) a coverage gap if the BOM/ENOENT test is omitted
(fix = add it per the branch map); (c) a prettier hex-casing nit (auto-fixed via
`npm run fix`). No runtime/network/LLM unknowns — TOML parsing is pure, tested with real
temp files.