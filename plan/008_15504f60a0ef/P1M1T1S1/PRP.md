# PRP — P1.M1.T1.S1: Include directive tokenizer with boundary and existence rules

> Foundation subtask for PRD §2.3 (Distributed / Multi-File PRDs). Establishes the
> tokenizer, the boundary + existence rules, single-level expansion, and the config
> constants that the rest of P1.M1 builds on. **S1 = tokenizer only.** Recursion /
> cycle-detection / depth-loop = S2; markers / idempotency / stale-include warnings = S3.

---

## Goal

**Feature Goal**: In `src/core/session-utils.ts`, add an exported `resolveIncludes(content, baseDir, opts?)`
that scans a raw PRD string for `@path/to/file.md` include directives, applies PRD §2.3's
**boundary** and **existence** rules, and substitutes each resolved directive's file contents
inline (single level). Add the `PRD_INCLUDE_MAX_DEPTH` and `PRD_INCLUDE_MARKERS` config
constants to `src/config/constants.ts`. This is the canonical resolver all downstream
consumers (hash, snapshot, delta, prompts — wired in P1.M1.T2) will call.

**Deliverable**:
1. **`src/config/constants.ts`** — append: `PRD_INCLUDE_MAX_DEPTH` (env-var name),
   `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`, `getPrdIncludeMaxDepth(): number`, and
   `PRD_INCLUDE_MARKERS` (env-var name).
2. **`src/core/session-utils.ts`** — append: `ResolveOpts` interface and
   `resolveIncludes(content, baseDir, opts?): Promise<string>`.
3. **`tests/unit/core/prd-includes.test.ts`** — NEW real-tmpdir test file covering boundary,
   existence, expansion, the maxDepth gate, and the error branches.
4. **Docs (Mode A)** — JSDoc on the new symbols; `.env.example` rows; a `### Distributed PRDs`
   subsection in `docs/CONFIGURATION.md`.

**Success Definition**:
- A `@docs/a.md` token (line-start, inline, or parenthesized) whose path resolves to an
  existing file is replaced inline by that file's UTF-8 contents.
- `foo@bar.com`, mid-word `@`, directory tokens, and missing-file tokens are left **verbatim
  and silent** (no throw, no warning in S1).
- `resolveIncludes` is **single-level** (it does not recurse into substituted content — that
  is S2).
- `getPrdIncludeMaxDepth()` returns `10` by default and honors a valid `PRD_INCLUDE_MAX_DEPTH`.
- `npm run typecheck && npm run lint && npm run format:check` are clean; the new test file
  passes and the touched lines in `session-utils.ts` are at 100% coverage.

---

## Why

- **Unblocks distributed PRDs (PRD §2.3).** Real PRDs span architecture/API/data-model files;
  they must assemble into one canonical document at load time. Today NO include-resolution
  code exists in `src/` (architecture/phase_findings.md §PHASE 1), so multi-file PRDs cannot
  be hashed, snapshotted, or diffed consistently.
- **Idempotency is a downstream invariant.** PRD §2.3 mandates that re-resolving yields
  identical bytes (the basis for hash/snapshot consistency). S1's "fall back to the original
  `@token` bytes when not expanded" + single-level substitution keeps the output deterministic
  and gives S3's idempotency guarantee a solid base.
- **Establishes the config surface.** `PRD_INCLUDE_MAX_DEPTH` (S2 consumes in the recursion
  loop) and `PRD_INCLUDE_MARKERS` (S3 consumes for marker emission) are declared now so S2/S3
  only add behavior, not new plumbing.
- **Scope discipline.** S1 deliberately stops at single-level. Implementing recursion (S2) or
  markers/warnings (S3) here would collide with those subtasks and duplicate work.

---

## What

### User-visible behavior
None directly (a load-time resolver). Indirectly, once P1.M1.T2 threads it through
`hashPRD`/snapshot/delta: a PRD containing `@docs/arch.md` is treated as if `docs/arch.md`'s
contents were pasted inline at that point.

### Technical requirements (exact contract)

**File 1 — `src/config/constants.ts`** (append; mirror the existing `RESEARCH_TIMEOUT` triple
at lines ~198–230 EXACTLY):
```ts
/** Env-var NAME: max recursion depth for PRD @-include expansion (PRD §2.3). */
export const PRD_INCLUDE_MAX_DEPTH = 'PRD_INCLUDE_MAX_DEPTH';

/** Default max include depth when PRD_INCLUDE_MAX_DEPTH is unset/invalid (PRD §2.3). */
export const DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10;

/** Read & validate PRD_INCLUDE_MAX_DEPTH (PRD §2.3). NaN / <=0 → default. */
export function getPrdIncludeMaxDepth(): number {
  const raw = Number(
    process.env[PRD_INCLUDE_MAX_DEPTH] ?? DEFAULT_PRD_INCLUDE_MAX_DEPTH
  );
  if (Number.isNaN(raw) || raw <= 0) return DEFAULT_PRD_INCLUDE_MAX_DEPTH;
  return raw;
}

/** Env-var NAME: emit <!-- @include --> markers around expanded includes (PRD §2.3; consumed in S3). */
export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';
```

**File 2 — `src/core/session-utils.ts`** (append "alongside `hashPRD`"). Add `stat` to the
existing `node:fs/promises` import line; reuse `readUTF8FileStrict`, `SessionFileError`,
`resolve`, and the lazy `logger()`:
```ts
/** Options for {@link resolveIncludes}. */
export interface ResolveOpts {
  /** Override the max-depth gate (defaults to getPrdIncludeMaxDepth()). S1 uses this only as
   *  a base-case gate; the recursive loop lands in S2. */
  maxDepth?: number;
  // (S3 will extend this interface with `markers?: boolean` — do NOT add it in S1.)
}

/**
 * Resolve `@path/to/file.md` include directives in a PRD string (PRD §2.3).
 *
 * SINGLE-LEVEL in S1: each resolved token is replaced by its file's contents verbatim;
 * substituted content is NOT re-scanned (recursive expansion + cycle detection = S2;
 * markers + stale-include warnings = S3).
 *
 * A token expands iff BOTH (1) BOUNDARY — the `@` is at content start or preceded by a
 * non-path char (path chars = [A-Za-z0-9_./-]); `foo@bar.com` and mid-word `@` stay literal;
 * AND (2) EXISTENCE — resolve(baseDir, token) is an existing FILE. Missing paths and
 * directories stay verbatim and silent.
 */
export async function resolveIncludes(
  content: string,
  baseDir: string,
  opts?: ResolveOpts
): Promise<string> { /* ... algorithm in blueprint ... */ }
```

**File 3 — `tests/unit/core/prd-includes.test.ts`** (NEW; REAL tmpdir, not vi.mock fs).

**File 4 — Docs**: JSDoc (above); `.env.example` rows; `docs/CONFIGURATION.md`
`### Distributed PRDs` subsection.

### Boundary + existence rule (the spec — implement exactly)

| Condition | Rule |
| --- | --- |
| BOUNDARY | `@` at content start, OR the char immediately before `@` is NOT in `[A-Za-z0-9_./-]`. |
| EXISTENCE | `resolve(baseDir, token)` exists AND `isFile()` is true. |

Path-char set = `[A-Za-z0-9_./-]` (word chars + `.` + `/` + `-`). Suggested tokenizer regex
(Node 20+, esnext target — lookbehind is supported):
```ts
const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;   // group 1 = path (no @)
```
Equivalent manual form if lookbehind is avoided: collect `@token` offsets, then
`idx === 0 || !/[\w./-]/.test(content[idx - 1])`. Either is acceptable; the **spec** is the
boundary definition above.

### Success Criteria
- [ ] `resolveIncludes` exported from `session-utils.ts`; `ResolveOpts` exported.
- [ ] Line-start, inline (space/`(`/etc. before `@`), and parenthesized tokens expand when the
      file exists; the surrounding `(` `)` and prose are preserved.
- [ ] `foo@bar.com`, `dir/@file.md`, and mid-word `@` stay literal (boundary fail).
- [ ] A token resolving to a missing file (ENOENT) stays verbatim, silent (no throw).
- [ ] A token resolving to a directory stays verbatim, silent (`isFile()` false).
- [ ] A token whose file exists but cannot be read (e.g. invalid UTF-8) throws `SessionFileError`.
- [ ] `opts.maxDepth = 0` (or `PRD_INCLUDE_MAX_DEPTH=0`) returns content unchanged (gate).
- [ ] Substituted content is NOT re-scanned (single-level; nested `@token` left as-is).
- [ ] `PRD_INCLUDE_MAX_DEPTH`, `DEFAULT_PRD_INCLUDE_MAX_DEPTH`, `getPrdIncludeMaxDepth()`,
      `PRD_INCLUDE_MARKERS` exported from `constants.ts`.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] New test file passes; touched `session-utils.ts` lines at 100% coverage.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — exact file paths, the helpers to reuse (with line numbers), the
constant triple to mirror (with line numbers), the precise boundary/existence spec with worked
examples, the single-level algorithm, the real-tmpdir test strategy with per-branch coverage
recipes, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — current-state scout + insertion points
- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "PHASE 1 — Distributed PRD Resolution & Selective Section Extraction"
  why: Confirms NO include-resolution code exists today; lists the downstream consumers
        (hashPRD, initialize snapshot, createDeltaSession, findSessionByHash, handleDelta) that
        P1.M1.T2 will wire up (NOT S1's job).
  critical: S1 only CREATES resolveIncludes; it does NOT wire it into hashPRD/snapshot/delta
        (that is P1.M1.T2.S1/S2). Editing those callers here is out of scope.

# MUST READ — PRD spec (verbatim rule)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs"
  why: Authoritative include-directive, boundary, existence, idempotency, and markers rules.
        (Also provided inline in this PRP's <selected_prd_content>.)

# MUST READ — design + algorithm + scope split (authored with this PRP)
- docfile: plan/008_15504f60a0ef/P1M1T1S1/research/include-tokenizer-design.md
  section: "2. The tokenizer rule" and "3. S1 algorithm" and "4. Scope discipline"
  why: Disambiguates boundary edge cases, gives the single-level algorithm, and pins what S1
        must NOT implement (recursion=S2, markers/warnings=S3).

# PATTERN FILE 1 — where resolveIncludes lives; helpers to reuse
- file: src/core/session-utils.ts
  why: Append resolveIncludes + ResolveOpts here. Reuse readUTF8FileStrict (:201), SessionFileError
        (:56), resolve (imported :23), and the lazy logger (:38-39). Add `stat` to the
        node:fs/promises import (do not add a second import line).
  pattern: "readUTF8FileStrict(path, operation) wraps readFile + fatal TextDecoder → SessionFileError on failure"
  gotcha: Do NOT modify hashPRD/readUTF8FileStrict/SessionFileError — only ADD exports.

# PATTERN FILE 2 — config constant triple to mirror exactly
- file: src/config/constants.ts
  why: Copy the RESEARCH_TIMEOUT triple (lines ~198-230) verbatim in shape for
        PRD_INCLUDE_MAX_DEPTH. Add PRD_INCLUDE_MARKERS as a name-only export (S3 consumes it).
  pattern: "export const X='X'; export const DEFAULT_X=N; export function getX(): number { const raw=Number(process.env[X] ?? DEFAULT_X); if(Number.isNaN(raw)||raw<=0) return DEFAULT_X; return raw; }"
  gotcha: PRD_INCLUDE_MARKERS is declared but UNUSED in S1 (S3 wires it). Exported consts are
        NOT flagged by no-unused-vars, so this is lint-safe — but do NOT reference it in
        session-utils.ts yet.

# PATTERN FILE 3 — real-tmpdir test style (do NOT copy the vi.mock fs style of session-utils.test.ts)
- file: tests/unit/core/tasks-json-recovery.test.ts
  why: This suite uses REAL tmpdir git repos (per phase_findings). Mirror that real-fs approach
        for resolveIncludes (existence/boundary logic is only trustworthy against real files).
  pattern: "mkdtempSync(join(tmpdir(), '...')); writeFileSync(join(tmp, ...)); ... assertions ...; rmSync(tmp,{recursive:true,force:true}) in afterEach"
  gotcha: The existing session-utils.test.ts vi.mock('node:fs/promises') — do NOT add resolveIncludes
        tests there; the mock would make existence checks meaningless. Use a SEPARATE real-fs file.

# DOC FILES (Mode A edits)
- file: .env.example
  why: Add `# PRD_INCLUDE_MAX_DEPTH=10` and `# PRD_INCLUDE_MARKERS=` rows near the existing
        resilience/config block. Mirror the commented-optional style already used.
- file: docs/CONFIGURATION.md
  why: Add a `### Distributed PRDs` subsection (mirror heading style of `### Resilience Tuning`
        at line 145). Document the directive, boundary+existence, PRD_INCLUDE_MAX_DEPTH (10),
        PRD_INCLUDE_MARKERS (optional). Cite PRD §2.3.
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts          # EDIT — append PRD_INCLUDE_MAX_DEPTH triple + PRD_INCLUDE_MARKERS
src/core/session-utils.ts        # EDIT — append ResolveOpts + resolveIncludes; add `stat` import
tests/unit/core/
├── session-utils.test.ts        # UNCHANGED (vi.mock fs style — leave as-is; still covers the rest of the file)
└── prd-includes.test.ts         # NEW — real-tmpdir tests for resolveIncludes
.env.example                     # EDIT — 2 rows
docs/CONFIGURATION.md            # EDIT — new subsection
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/constants.ts          # MODIFIED (append-only)
src/core/session-utils.ts        # MODIFIED (append-only + one import-key addition: `stat`)
tests/unit/core/prd-includes.test.ts   # NEW
.env.example                     # MODIFIED (append 2 rows)
docs/CONFIGURATION.md            # MODIFIED (append subsection)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S1 is SINGLE-LEVEL. Do NOT recurse into substituted content, do NOT add cycle
//   detection, do NOT add depth-decrement loops (all S2). Do NOT emit <!-- @include --> markers
//   or stale-include stderr warnings (all S3). S1 declares PRD_INCLUDE_MARKERS but does not use it.

// CRITICAL — lint: @typescript-eslint/no-unused-vars has NO blanket param-ignore (only ^_).
//   So opts MUST be used. S1 honors opts?.maxDepth for the depth gate (see algorithm). Do NOT
//   add a `markers` field to ResolveOpts in S1 (it would be unused → lint error); S3 adds it.

// GOTCHA — reuse readUTF8FileStrict for the read (it gives fatal-UTF-8 + SessionFileError for free).
//   Use stat() for existence (so a directory → isFile() false → silent, NOT an error). A token
//   resolving to a directory is "not an existing file" → verbatim/silent (PRD §2.3 "existing file").

// GOTCHA — fall back to the ORIGINAL match text (m[0], the full "@token") when not expanded,
//   never to a re-serialization. This preserves exact bytes (idempotency-friendly for S3).

// GOTCHA — path resolution is project-root-relative: resolve(baseDir, token). baseDir is the
//   ENTRY PRD's directory (passed in by the caller in P1.M1.T2). S1 just uses the arg; it does
//   not compute baseDir.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error in .eslintrc.json). Run
//   `npm run fix` before format:check. Lookbehind regex / long JSDoc may need reformatting.

// GOTCHA — vitest.config.ts enforces 100% coverage (statements/branches/functions/lines) on
//   src/**/*.ts. Every branch of resolveIncludes + getPrdIncludeMaxDepth must be hit. The
//   real-tmpdir test covers: expand, boundary-fail-literal, ENOENT-silent, directory-silent,
//   invalid-UTF-8-read-error (SessionFileError), stat-EACCES (chmod 000, Linux), maxDepth=0 gate.

// GOTCHA — do NOT wire resolveIncludes into hashPRD/snapshotPRD/createDeltaSession/etc. That is
//   P1.M1.T2.S1/S2. S1 only creates + tests the function.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/core/session-utils.ts (append)
export interface ResolveOpts {
  maxDepth?: number;   // S1: depth gate only. S2 adds the recursive loop; S3 adds markers?: boolean.
}

// src/config/constants.ts (append) — mirror the RESEARCH_TIMEOUT triple
export const PRD_INCLUDE_MAX_DEPTH = 'PRD_INCLUDE_MAX_DEPTH';
export const DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10;
export function getPrdIncludeMaxDepth(): number { /* NaN/<=0 → default */ }
export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';   // consumed in S3
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config/constants.ts — add the config surface
  - APPEND (mirror RESEARCH_TIMEOUT triple at ~L198-230): PRD_INCLUDE_MAX_DEPTH (name),
        DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10, getPrdIncludeMaxDepth(): number (NaN/<=0 → default),
        PRD_INCLUDE_MARKERS (name only).
  - NAMING: UPPER_SNAKE consts; getPrdIncludeMaxDepth getter (camelCase).
  - JSDOC: each symbol (match existing style; cite PRD §2.3).
  - DO NOT consume PRD_INCLUDE_MARKERS anywhere in S1.

Task 2: EDIT src/core/session-utils.ts — add ResolveOpts + resolveIncludes
  - ADD `stat` to the existing `import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';` line.
  - APPEND ResolveOpts interface (maxDepth?: number ONLY — no markers field in S1).
  - APPEND resolveIncludes(content, baseDir, opts?): Promise<string> using the algorithm below.
  - REUSE: readUTF8FileStrict, SessionFileError, resolve (from node:path), logger().
  - DO NOT modify hashPRD / readUTF8FileStrict / SessionFileError / any existing export.
  - PLACEMENT: near hashPRD (e.g. immediately after it), per contract "alongside hashPRD".

Task 3: CREATE tests/unit/core/prd-includes.test.ts — REAL tmpdir, NO vi.mock fs
  - IMPORT: resolveIncludes, SessionFileError from '../../../src/core/session-utils.js';
        getPrdIncludeMaxDepth, DEFAULT_PRD_INCLUDE_MAX_DEPTH from '../../../src/config/constants.js';
        vitest primitives; node:fs (mkdtempSync/writeFileSync/rmSync/chmodSync),
        node:os tmpdir, node:path join.
  - STRUCTURE: describe('resolveIncludes') with an afterEach that rmSync's the tmp dir.
  - CASES (cover every branch):
      * line-start '@docs/a.md' → expands to file contents.
      * inline 'see @docs/a.md here' and parenthesized '(@docs/a.md)' → expand inline, prose kept.
      * 'foo@bar.com' and 'dir/@file.md' → literal (boundary fail).
      * '@missing.md' (ENOENT) → literal, silent (resolveIncludes does not throw).
      * token pointing at a directory → literal, silent (isFile false).
      * token pointing at a file with INVALID utf-8 bytes → throws SessionFileError (read branch).
      * (Linux only, process.platform!=='win32') chmod 000 file → stat EACCES → SessionFileError.
      * nested token in included file is NOT re-expanded (single-level): include a file whose
        content is '@docs/other.md'; assert the literal '@docs/other.md' survives in output.
      * opts.maxDepth=0 → content returned unchanged (and no stat performed — e.g. spy or just
        assert identity for a content that WOULD otherwise expand).
  - GETTER CASES (describe('getPrdIncludeMaxDepth')): unset→10; 'abc'→10; '0'→10; '-1'→10; '4'→4
        (use vi.stubEnv + vi.unstubAllEnvs; mirror the env-stubbing in tests/unit/config).
  - NAMING: it('expands a line-start include'), it('leaves foo@bar.com literal'), etc.
  - PLACEMENT: tests/unit/core/prd-includes.test.ts.

Task 4: EDIT docs (Mode A)
  - .env.example: append '# PRD_INCLUDE_MAX_DEPTH=10' and '# PRD_INCLUDE_MARKERS=' (commented).
  - docs/CONFIGURATION.md: add '### Distributed PRDs' subsection (mirror '### Resilience Tuning'
        heading style, line ~145); document directive + boundary + existence + the two env vars;
        cite PRD §2.3.
  - JSDoc on resolveIncludes + ResolveOpts (mirror hashPRD's @remarks/@param/@returns/@example).

Task 5: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-includes.test.ts (new suite green; 100% of new lines).
  - RUN: npx vitest run tests/unit/core/session-utils.test.ts (regression — must stay green).
  - EXPECTED: all clean. If coverage <100% on session-utils.ts, a branch of resolveIncludes or
        getPrdIncludeMaxDepth is unhit — add the matching real-tmpdir case from Task 3.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the S1 algorithm (single-level). async-safe: collect matches, then resolve each.
import { stat } from 'node:fs/promises';              // ADD to existing import line
// readUTF8FileStrict, SessionFileError, resolve, logger() already in this file.

const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;   // group 1 = path (no @)

export async function resolveIncludes(
  content: string,
  baseDir: string,
  opts?: ResolveOpts
): Promise<string> {
  const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();
  if (maxDepth < 1) return content;                       // depth gate (base case S2 recurses against)

  const matches = [...content.matchAll(INCLUDE_TOKEN)];   // collect first
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    out += content.slice(last, idx);                      // gap before token (verbatim)
    const token = m[1];
    const abs = resolve(baseDir, token);
    let replacement: string | undefined;
    try {
      const st = await stat(abs);
      if (st.isFile()) {
        replacement = await readUTF8FileStrict(abs, 'read include');  // fatal UTF-8 + SessionFileError
      }
      // else: directory → not a file → replacement stays undefined (silent verbatim)
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        // missing → silent verbatim (S3 adds the .md-token stderr warning)
      } else {
        throw new SessionFileError(abs, 'stat include', e as Error);
      }
    }
    out += replacement ?? m[0];                            // substitute OR keep original bytes
    last = idx + m[0].length;
  }
  out += content.slice(last);                              // tail
  return out;
}

// PATTERN — config getter mirrors getResearchTimeoutSeconds() exactly.
export function getPrdIncludeMaxDepth(): number {
  const raw = Number(process.env[PRD_INCLUDE_MAX_DEPTH] ?? DEFAULT_PRD_INCLUDE_MAX_DEPTH);
  if (Number.isNaN(raw) || raw <= 0) return DEFAULT_PRD_INCLUDE_MAX_DEPTH;
  return raw;
}
```

### Integration Points

```yaml
DOWNSTREAM (S1 ENABLES these — do NOT do them here):
  - P1.M1.T1.S2 (recursion): wraps resolveIncludes in a depth-decrementing recursive loop with
        cycle detection (visited-set). S1's maxDepth gate + single-level substitution is the
        base case. S2 will likely add a `resolvePRD(prdPath, opts?)` wrapper.
  - P1.M1.T1.S3 (markers/idempotency/warnings): extends ResolveOpts with `markers?: boolean`,
        reads PRD_INCLUDE_MARKERS, emits <!-- @include: path --> / <!-- @end-include -->, and
        emits the stale-include `.md`-token stderr warning. Consumes the PRD_INCLUDE_MARKERS
        constant S1 declared.
  - P1.M1.T2.S1/S2 (wiring): threads resolved content through hashPRD, snapshot, createDeltaSession,
        findSessionByHash, handleDelta. S1 only PROVIDES resolveIncludes; it does not call it
        from those paths.

NO OTHER INTEGRATION in S1: no CLI, no pipeline, no agent. resolveIncludes is a pure
  (content, baseDir) → content function consumed later.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first; lookbehind regex/JSDoc may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused-vars on opts)
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags `opts`, ensure you read opts?.maxDepth (the gate).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass + cover 100% of the new lines):
npx vitest run tests/unit/core/prd-includes.test.ts
# Regression — the existing mocked suite must stay green (S1 only ADDS exports):
npx vitest run tests/unit/core/session-utils.test.ts
# Coverage check on the two touched source files:
npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/session-utils.test.ts --coverage
# Expected: prd-includes green; session-utils green; session-utils.ts + constants.ts at 100% on new lines.
# If a branch is uncovered, add the matching real-tmpdir case (see Task 3 CASES).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1 — resolveIncludes is a pure function; it is not yet wired into the pipeline (that is
# P1.M1.T2). Smoke-test it directly against a real multi-file PRD layout:
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolveIncludes } from './src/core/session-utils.ts';
const d = mkdtempSync(join(tmpdir(), 'inc-'));
writeFileSync(join(d, 'docs.md'), 'ARCH BODY');
writeFileSync(join(d, 'main.md'), 'Top\n@docs.md\nBottom\n');
resolveIncludes('Top\n@docs.md\nBottom\n', d).then(r => { console.log(JSON.stringify(r)); rmSync(d, { recursive: true, force: true }); });
"
# Expected output: "Top\nARCH BODY\nBottom\n" (the @docs.md token replaced inline, single-level).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — no MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - foo@bar.com / dir/@file.md / mid-word @ survive literal (boundary).
#   - missing file + directory tokens survive silent (existence) — no throw, no warning in S1.
#   - single-level: an @token inside an included file is NOT expanded (asserted in Task 3).
#   - maxDepth gate: maxDepth<1 → identity.
#   - PRD_INCLUDE_MARKERS declared but not yet consumed (S3 will wire marker emission).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused-vars on `opts`).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts` green.
- [ ] `npx vitest run tests/unit/core/session-utils.test.ts` green (regression).
- [ ] Touched lines in `src/core/session-utils.ts` and `src/config/constants.ts` at 100% coverage.

### Feature Validation
- [ ] Line-start, inline, and parenthesized `@token`s expand when the file exists.
- [ ] `foo@bar.com`, `dir/@file.md`, mid-word `@` stay literal (boundary).
- [ ] Missing-file (ENOENT) and directory tokens stay verbatim + silent.
- [ ] Read failure (invalid UTF-8 / EACCES) throws `SessionFileError`.
- [ ] Single-level: nested `@token` in included content is NOT re-expanded.
- [ ] `opts.maxDepth = 0` / `PRD_INCLUDE_MAX_DEPTH=0` → content unchanged.
- [ ] `getPrdIncludeMaxDepth()` returns 10 by default; honors valid env override.
- [ ] All 4 new symbols exported (resolveIncludes, ResolveOpts, PRD_INCLUDE_MAX_DEPTH+default+getter,
      PRD_INCLUDE_MARKERS).

### Code Quality Validation
- [ ] Only ADDS to `constants.ts` and `session-utils.ts` (append + one import key `stat`); no existing
      export modified.
- [ ] Reuses `readUTF8FileStrict` / `SessionFileError` / `resolve` / lazy `logger()` (no reinvention).
- [ ] Config triple mirrors `RESEARCH_TIMEOUT` exactly.
- [ ] Real-tmpdir test file (NOT vi.mock fs) — separate from `session-utils.test.ts`.
- [ ] No recursion / cycle-detection (S2); no markers / stale warnings (S3) implemented here.

### Documentation & Deployment
- [ ] JSDoc on `resolveIncludes` + `ResolveOpts` (mirror `hashPRD`).
- [ ] `.env.example` has `PRD_INCLUDE_MAX_DEPTH` + `PRD_INCLUDE_MARKERS` rows.
- [ ] `docs/CONFIGURATION.md` has a `### Distributed PRDs` subsection citing PRD §2.3.
- [ ] Commit message notes: single-level tokenizer; recursion=S2, markers=S3; not yet wired (P1.M1.T2).

---

## Anti-Patterns to Avoid

- ❌ Don't implement recursion, cycle detection, or a depth-decrement loop — that's S2. S1 is single-level.
- ❌ Don't emit `<!-- @include -->` markers or stale-include stderr warnings — that's S3. (Declare `PRD_INCLUDE_MARKERS` but don't consume it.)
- ❌ Don't add a `markers` field to `ResolveOpts` in S1 — it would be unused (lint error); S3 adds it.
- ❌ Don't wire `resolveIncludes` into `hashPRD`/snapshot/delta/pipeline — that's P1.M1.T2. S1 only creates + tests the function.
- ❌ Don't treat a directory token as an error — PRD §2.3 says "existing **file**"; a directory → silent verbatim.
- ❌ Don't reinvent file reading — reuse `readUTF8FileStrict` (gives fatal UTF-8 + `SessionFileError` for free).
- ❌ Don't add `resolveIncludes` tests to the mocked `session-utils.test.ts` — existence/boundary logic is only meaningful against REAL files. Use a new real-tmpdir file.
- ❌ Don't re-serialize unexpanded tokens — fall back to the original match text `m[0]` to preserve exact bytes.
- ❌ Don't modify any existing export in `constants.ts`/`session-utils.ts` — append only (plus adding `stat` to the existing import line).
- ❌ Don't skip coverage of the error branches — vitest enforces 100%; use invalid-UTF-8 (read branch) and chmod 000 (stat-EACCES branch) on Linux.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The spec is unambiguous and self-contained — a pure `(content, baseDir) → content`
function with a precisely defined boundary rule (with worked examples), an existence rule, a
single-level algorithm, and a config triple that mirrors an existing one verbatim. Every helper
to reuse (`readUTF8FileStrict`, `SessionFileError`, `resolve`, lazy `logger`, the
`RESEARCH_TIMEOUT` constant pattern) is named with line numbers. The test strategy is concrete
(real tmpdir, with a per-branch coverage recipe including the tricky error branches via
invalid-UTF-8 and chmod 000). Scope boundaries with S2/S3/P1.M1.T2 are explicit so the
implementer won't collide. The only residual risks are (a) the lookbehind regex needing a
manual-char fallback on some esbuild interpretation (the manual form is provided), (b) the
chmod-000 stat-EACCES branch being skipped on Windows (guarded), and (c) a prettier nit on the
regex/JSDoc (auto-fixed via `npm run fix`). No external/runtime unknowns.