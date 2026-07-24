# PRP — P1.M1.T1.S2: Recursive expansion engine with cycle detection and max depth

> Builds the recursive entry point `resolvePRD(prdPath, opts?)` on top of S1's single-level
> `resolveIncludes` (PRD §2.3). S2 = recursion + path-based cycle detection + max-depth gate +
> the project-root-relative base invariant. **Markers / idempotency / stale-include warnings =
> S3** (S2 leaves the worker structured for S3 to wrap). **Wiring into hash/snapshot/delta =
> P1.M1.T2** (S2 only provides the function).

---

## Goal

**Feature Goal**: In `src/core/session-utils.ts`, add an exported `resolvePRD(prdPath, opts?)`
that reads the entry PRD and recursively expands `@path/to/file.md` include directives to their
full depth — with **path-based cycle detection** (a visited `Set<string>` of absolute ancestry
paths, diamond-safe) and a **max-depth abort** at `PRD_INCLUDE_MAX_DEPTH` (default 10). All
include paths resolve **project-root-relative** — against the entry PRD's directory, never the
including file's directory (PRD §2.3).

**Deliverable**:
1. **`src/core/session-utils.ts`** — append `resolvePRD(prdPath: string, opts?: ResolveOpts): Promise<string>`
   and a module-private recursive worker. ResolveOpts is reused UNCHANGED from S1 (`{ maxDepth? }`).
2. **`tests/unit/core/prd-resolve.test.ts`** — NEW real-tmpdir test file (separate from S1's
   `prd-includes.test.ts`) covering recursion, cycles (self + mutual), diamonds, max-depth,
   the base invariant, and every error branch.
3. **Docs (Mode A)** — JSDoc on `resolvePRD` documenting recursive expansion, cycle detection,
   and the project-root-relative base invariant.

**Success Definition**:
- A nested include chain (entry→a→b→c) fully expands inline to the deepest level.
- A self-cycle (a→a) and a mutual cycle (a→b→a) terminate gracefully — the back-edge `@token`
  is left literal (no infinite loop, no throw).
- A diamond (entry→a→c AND entry→b→c) expands `c` in BOTH branches (not deduplicated).
- An include in a sub-directory file resolves against the **entry PRD's directory**, not the
  including file's directory (base invariant).
- Depth beyond `PRD_INCLUDE_MAX_DEPTH` (or `opts.maxDepth`) stops expanding — remaining tokens
  stay literal.
- Entry-file read errors throw `SessionFileError`; missing-file / directory / cycle tokens are
  silent + verbatim (S3 adds warnings).
- `npm run typecheck && npm run lint && npm run format:check` clean; new test file passes;
  touched lines in `session-utils.ts` at 100% coverage; S1's `prd-includes.test.ts` still green.

---

## Why

- **Completes recursive expansion (PRD §2.3).** S1 established the single-level tokenizer;
  real PRDs nest includes (architecture → API → data-model → companion docs) and must assemble
  into ONE canonical document. Without recursion, nested `@token`s survive literal and the
  downstream hash/snapshot/diff would diverge from a monolithic PRD.
- **Cycle safety.** A PRD that (accidentally or intentionally) includes itself, or forms a
  mutual include, must not hang the pipeline. S2's path-based visited set detects cycles and
  leaves the back-edge literal; the max-depth gate is a hard backstop.
- **Base-invariant correctness.** PRD §2.3 mandates project-root-relative resolution so a split
  PRD behaves identically regardless of which file holds the directive. S2 fixes `baseDir` to
  the entry PRD's directory and never re-derives it.
- **Unblocks S3 + P1.M1.T2.** S3 layers markers/idempotency/warnings on the resolved output;
  P1.M1.T2 threads the resolved document through `hashPRD`/snapshot/delta/prompt-injection. Both
  consume `resolvePRD`.
- **Scope discipline.** S2 does NOT touch S1's `resolveIncludes`/`ResolveOpts`/constants, does
  NOT emit markers or warnings (S3), and does NOT wire the function into hash/snapshot/delta
  (P1.M1.T2).

---

## What

### User-visible behavior
None directly (a load-time resolver consumed by the pipeline). Indirectly, once P1.M1.T2 wires
it: a PRD whose entry file contains `@docs/arch.md`, where `docs/arch.md` itself contains
`@docs/api.md`, is treated as if both files' contents were pasted inline in order.

### Technical requirements (exact contract)

**`src/core/session-utils.ts`** — append (do NOT modify S1's `resolveIncludes`/`ResolveOpts`):

```ts
/**
 * Resolve a PRD entry file, recursively expanding `@path/to/file.md` includes (PRD §2.3).
 *
 * @remarks
 * Reads the entry PRD, then recursively expands include directives to their full depth:
 *  - CYCLE DETECTION: a path-based visited Set (absolute paths of the current ancestry) prevents
 *    infinite recursion on self/mutual cycles; the back-edge `@token` is left literal.
 *    Diamond includes (a→c and b→c) still expand `c` in both branches.
 *  - MAX DEPTH: expansion stops at PRD_INCLUDE_MAX_DEPTH (default 10); deeper `@token`s stay literal.
 *  - BASE INVARIANT: all paths resolve project-root-relative — against the entry PRD's directory,
 *    regardless of which file contains the directive.
 * Missing files, directories, and cycle back-edges stay verbatim + silent (S3 adds warnings).
 *
 * @param prdPath - Path to the entry PRD file (relative or absolute).
 * @param opts - Optional {@link ResolveOpts} (currently only `maxDepth`).
 * @returns The fully include-expanded document.
 * @throws {SessionFileError} If the entry file (or any included file) cannot be read / is invalid UTF-8,
 *         or a `stat` fails with a non-ENOENT error.
 */
export async function resolvePRD(
  prdPath: string,
  opts?: ResolveOpts
): Promise<string>;
```

Algorithm (exact — see Blueprint for full code):
1. `const absEntry = resolve(prdPath);` `const baseDir = dirname(absEntry);` (base invariant).
2. Read entry via `readUTF8FileStrict(absEntry, 'read PRD')` (SessionFileError on failure).
3. `const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();`
4. Seed `visited = new Set<string>([absEntry])` (so an include pointing back at the entry is a cycle).
5. `return expandIncludesRecursive(entryContent, baseDir, maxDepth, 0, visited);`

Worker `expandIncludesRecursive(content, baseDir, maxDepth, depth, visited): Promise<string>`:
- Base case: `if (depth >= maxDepth) return content;`
- `[...content.matchAll(INCLUDE_TOKEN)]` (re-declare the identical regex — see Gotchas), then for
  each match: copy gap verbatim; `const abs = resolve(baseDir, token);`
  - **cycle**: `if (visited.has(abs)) { out += m[0]; continue; }` (literal back-edge)
  - `stat(abs)` → if `isFile()`: read via `readUTF8FileStrict`, then recurse with
    `new Set(visited).add(abs)` at `depth + 1` (path-based ancestry), substitute the expanded child.
  - ENOENT → silent literal (`m[0]`); other stat error → `SessionFileError`.
  - directory (isFile false) → silent literal.
- Append tail; return.

### Success Criteria

- [ ] `resolvePRD` exported from `session-utils.ts`; reuses S1's `ResolveOpts` unchanged.
- [ ] Nested chain (entry→a→b→c) fully expands inline.
- [ ] Self-cycle (a→a) terminates; the self-`@token` stays literal; no throw.
- [ ] Mutual cycle (a→b→a) terminates; the back-edge `@token` stays literal; no throw.
- [ ] Diamond (entry→a→c and entry→b→c) expands `c` in BOTH branches.
- [ ] A `@token` inside a sub-directory file resolves against the ENTRY PRD's directory (base invariant).
- [ ] Depth beyond `opts.maxDepth` (and default `PRD_INCLUDE_MAX_DEPTH`) stops expanding; deeper tokens stay literal.
- [ ] Entry-file ENOENT / invalid-UTF-8 → `SessionFileError`; missing/dir/cycle includes → silent verbatim.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] New test file passes; touched `session-utils.ts` lines at 100% coverage; S1 suite still green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact S1 surface to reuse (verified in-repo with line
numbers), the full algorithm, the path-based-visited-set rationale, the per-branch test recipes
that map 1:1 to coverage, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the dependency contract (S1 is landed; treat as immutable)
- file: src/core/session-utils.ts
  why: S1's resolveIncludes (single-level) + ResolveOpts + reusable helpers live here.
        S2 APPENDS resolvePRD + worker alongside resolveIncludes. Reuses: readUTF8FileStrict,
        SessionFileError, stat (imported line 33), resolve/join/dirname/basename (line 34),
        logger(), and getPrdIncludeMaxDepth (from constants).
  critical: INCLUDE_TOKEN is MODULE-PRIVATE (const, not exported) — S2 re-declares the identical
        regex in its worker (one line; fixed contract). S2 must NOT modify resolveIncludes or
        ResolveOpts or any S1 export.

- file: src/config/constants.ts
  why: S1's PRD_INCLUDE_MAX_DEPTH / DEFAULT_PRD_INCLUDE_MAX_DEPTH (=10) / getPrdIncludeMaxDepth().
  pattern: "getPrdIncludeMaxDepth(): number → NaN/<=0 returns 10"

# MUST READ — design + the Option-B rationale (authored with this PRP)
- docfile: plan/008_15504f60a0ef/P1M1T1S2/research/recursive-resolver-design.md
  section: "2. THE design decision" and "3. Cycle detection MUST be path-based" and "5. Project-root-relative base invariant"
  why: Explains WHY true recursion (not fixpoint) is required, WHY the visited set is path-based
        (diamond-safe), and pins the base-invariant. Read before implementing.

- docfile: plan/008_15504f60a0ef/architecture/phase_findings.md
  section: "PHASE 1 — Distributed PRD Resolution & Selective Section Extraction" → "Insertion Points"
  why: Confirms resolvePRD is the primary entry; lists the downstream callers (hashPRD, initialize
        snapshot, createDeltaSession, findSessionByHash, handleDelta) that P1.M1.T2 wires — NOT S2.
  critical: S2 only CREATES resolvePRD; it must NOT edit those callers.

- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs"
  why: Authoritative include-directive / boundary / existence / recursion / cycle / base / markers
        rules. (Also provided inline in this PRP's <selected_prd_content>.)

# PATTERN FILES
- file: src/core/session-utils.ts (resolveIncludes, ~line 333)
  why: S2's worker MIRRORS resolveIncludes's scan loop + error handling (stat/isFile/ENOENT/
        SessionFileError/m[0]-fallback) but adds: the `visited.has(abs)` cycle check and recursive
        descent instead of a verbatim substitution.
  pattern: "out += replacement ?? m[0];   // fall back to ORIGINAL match bytes (idempotency-friendly)"

- file: tests/unit/core/prd-includes.test.ts
  why: S1's REAL-tmpdir test style to MIRROR (mkdtempSync/writeFileSync/mkdirSync/rmSync). S2 uses a
        SEPARATE file (no collision). Do NOT copy S1's single-level cases — S2 tests recursion.
  gotcha: Do NOT add resolvePRD tests to session-utils.test.ts (it vi.mock's node:fs/promises —
        existence/cycle logic would be meaningless). Real tmpdir only.

- file: tests/unit/core/tasks-json-recovery.test.ts
  why: Additional real-fs tmpdir precedent (mkdtemp/rm patterns) for the test scaffolding.
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts          # S1 owns (landed) — S2 imports getPrdIncludeMaxDepth (+DEFAULT/maxDepth)
src/core/session-utils.ts        # S1 owns resolveIncludes/ResolveOpts (landed) — S2 APPENDS resolvePRD + worker
tests/unit/core/
├── session-utils.test.ts        # UNCHANGED (vi.mock fs style — leave as-is)
├── prd-includes.test.ts         # S1 (landed) — single-level tests; S2 must NOT touch
└── prd-resolve.test.ts          # ← S2 CREATES (recursive resolvePRD tests; real tmpdir)
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/session-utils.ts              # MODIFIED (append-only: resolvePRD + module-private worker)
tests/unit/core/prd-resolve.test.ts    # NEW
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — INCLUDE_TOKEN is MODULE-PRIVATE in S1 (const, not exported). S2 RE-DECLARES the
// identical regex in its worker. Do NOT try to import it; do NOT add `export` to S1's const
// (that would modify S1's code). The regex is a fixed one-line contract:
const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;   // group 1 = path token (no @)

// CRITICAL — visited set must be PATH-BASED (per-branch), not a flat global set. Copy it on
// each recursive descent: `new Set(visited).add(abs)`. A flat set would wrongly deduplicate
// diamond includes (a→c and b→c must expand c in BOTH). See research note §3.

// CRITICAL — baseDir is computed ONCE from dirname(resolve(prdPath)) and passed UNCHANGED into
// every recursive call. NEVER re-derive it from an included file's location — that would break
// the project-root-relative invariant (PRD §2.3). A @token inside sub/a.md resolves to
// <entryDir>/token, NOT <entryDir>/sub/token.

// CRITICAL — S2 reuses S1's ResolveOpts UNCHANGED ({ maxDepth?: number }). Do NOT add a
// `markers` field — S3 owns it (collision-free). opts?.maxDepth overrides getPrdIncludeMaxDepth().

// CRITICAL — S2 must NOT modify resolveIncludes, ResolveOpts, INCLUDE_TOKEN, or any constant.
// Append-only to session-utils.ts. S1's prd-includes.test.ts must stay green unchanged.

// GOTCHA — depth semantics: entry is depth 0; recurse at depth+1; base case `if (depth >= maxDepth)
//   return content`. So maxDepth = N allows N levels of include nesting below the entry. Default 10.

// GOTCHA — seed visited with the ENTRY file's absolute path (absEntry) so an include pointing
//   back at the entry is correctly detected as a cycle.

// GOTCHA — when a token does NOT expand (ENOENT, directory, cycle, or depth-exceeded), fall back
//   to the ORIGINAL match text m[0] (the full "@token"), never a re-serialization. Preserves
//   exact bytes (idempotency-friendly for S3).

// GOTCHA — reuse readUTF8FileStrict for BOTH the entry read AND included-file reads (consistent
//   strict-UTF-8 + SessionFileError). Do NOT call readFile directly.

// GOTCHA — prettier is ERROR-enforced (prettier/prettier: error in .eslintrc.json). Run
//   `npm run fix` before format:check. The recursive worker's nested try/catch + JSDoc may need it.

// GOTCHA — 100% coverage is enforced (vitest.config.ts). Every branch of resolvePRD + the worker
//   must be hit: depth-gate TRUE/FALSE, visited.has TRUE/FALSE, isFile TRUE/FALSE, ENOENT,
//   stat-non-ENOENT (SessionFileError), read-fail (SessionFileError), entry-read-fail. The 13
//   test cases in Task 3 map 1:1 to these branches.

// GOTCHA — no `any` in src/ (it's `warn`); cast NodeJS.ErrnoException for errno-code reads.
//   Lookbehind regex is fine (esnext target, Node 20+).
```

---

## Implementation Blueprint

### Data models and structure

No new data models — S2 consumes S1's `ResolveOpts`. The only "model" is the
`resolvePRD` signature and the recursive-worker contract:

```ts
// src/core/session-utils.ts (append) — reuses S1's ResolveOpts { maxDepth?: number }
export async function resolvePRD(prdPath: string, opts?: ResolveOpts): Promise<string>;

// module-private (NOT exported) — the recursive worker
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>
): Promise<string>;
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/core/prd-resolve.test.ts   (RED — must fail before impl)
  - IMPORT: resolvePRD, SessionFileError from '../../../src/core/session-utils.js';
        getPrdIncludeMaxDepth, DEFAULT_PRD_INCLUDE_MAX_DEPTH from '../../../src/config/constants.js';
        vitest primitives; node:fs (mkdtempSync/writeFileSync/mkdirSync/rmSync), node:os tmpdir,
        node:path join.
  - STRUCTURE: describe('resolvePRD') with beforeEach(mkdtempSync) + afterEach(rmSync recursive).
        Mirror S1's prd-includes.test.ts scaffolding. REAL tmpdir — NO vi.mock('node:fs/promises').
  - CASES (cover every branch; each maps to a coverage branch):
      1. single-level: entry has '@a.md', a.md has no includes → a.md body inline.
      2. nested 3-deep: entry→a→b→c (each file includes the next) → all expanded inline in order.
      3. self-cycle: a.md contains '@a.md' → terminates; the self '@a.md' stays literal; no throw.
      4. mutual cycle: a→b→a → terminates; the back-edge '@a.md' (inside b.md) stays literal; no throw.
      5. diamond: entry has '@a.md\n@b.md'; a.md and b.md each contain '@shared.md'; shared.md body
         'S' → result contains 'S' TWICE (once per branch). Assert result.split('S').length === 3
         (two S's). This is the diamond-safe path-based-set proof.
      6. max-depth gate: opts.maxDepth=1 with entry→a→b → a expanded, b's '@b' inside a NOT expanded
         (stays literal '@b'). Covers the depth>=maxDepth TRUE branch.
      7. default depth large: a 12-deep chain with default maxDepth(10) → 10 levels expand, levels
         11-12 stay literal. (Optional — proves default bound; can be folded with case 6.)
      8. missing include deep in recursion: entry→a, a contains '@missing.md' → '@missing.md' stays
         literal, silent (no throw). Covers ENOENT branch inside recursion.
      9. BASE-INVARIANT (critical): entry at <tmp>/PRD.md includes '@sub/a.md'; sub/a.md includes
         '@shared.md'; write shared.md at <tmp>/shared.md (NOT <tmp>/sub/shared.md). Assert shared.md
         body appears (resolves against entry dir, not sub/). Also assert <tmp>/sub/shared.md does NOT
         need to exist. Proves project-root-relative base.
      10. directory token deep in recursion: a.md contains '@docs' where docs is a directory → literal,
          silent. Covers isFile-false branch.
      11. entry missing: resolvePRD('<tmp>/nope.md') → rejects with SessionFileError (ENOENT).
          Covers entry-read failure.
      12. invalid UTF-8 deep in recursion: write a.md with invalid-utf8 bytes (Buffer) → resolvePRD
          rejects with SessionFileError (readUTF8FileStrict fatal decode). Covers read-fail branch.
      13. opts.maxDepth override + boundary: entry has NO includes → result === entry content exactly
          (identity, also proves idempotency-friendly single-pass). Covers the no-match path.
  - NAMING: it('recursively expands a nested chain'), it('terminates a self-cycle leaving the back-edge literal'),
        it('expands a diamond in both branches'), it('resolves includes against the entry PRD directory'), etc.
  - PLACEMENT: tests/unit/core/prd-resolve.test.ts (distinct from S1's prd-includes.test.ts).
  - EXPECTED NOW: import of resolvePRD fails → RED.

Task 2: EDIT src/core/session-utils.ts — append resolvePRD + the recursive worker (GREEN)
  - APPEND (after resolveIncludes): the INCLUDE_TOKEN re-declaration (identical regex, comment noting
        it mirrors S1's private const), resolvePRD, and the module-private expandIncludesRecursive.
  - REUSE: readUTF8FileStrict (entry + child reads), SessionFileError, stat, resolve, dirname, logger(),
        getPrdIncludeMaxDepth (import from '../config/constants.js' — confirm S1 already imported it;
        if not, add to the existing constants import line).
  - IMPLEMENT the exact algorithm in "Technical requirements" + the full code below.
  - DO NOT modify resolveIncludes / ResolveOpts / INCLUDE_TOKEN(S1's) / any S1 export.
  - FORWARD-COMPAT (S3): keep the child-substitution as a single clear site (`out += expanded;`) so
        S3 can wrap it with <!-- @include --> markers later. Do NOT emit markers in S2.
  - PLACEMENT: immediately after resolveIncludes (logical grouping with the resolver family).
  - EXPECTED: prd-resolve.test.ts cases 1–13 turn GREEN; 100% coverage of the new lines.

Task 3: EDIT docs (Mode A)
  - JSDoc on resolvePRD (mirror resolveIncludes's @remarks/@param/@returns/@throws/@example style):
        document RECURSIVE expansion, PATH-BASED cycle detection (diamond-safe), MAX DEPTH, and the
        PROJECT-ROOT-RELATIVE base invariant. Cite PRD §2.3.
  - (No .env.example / CONFIGURATION.md edits needed — S1 already documented PRD_INCLUDE_MAX_DEPTH.)

Task 4: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts (new suite green; 100% of new lines).
  - RUN: npx vitest run tests/unit/core/prd-includes.test.ts (S1 regression — must stay green).
  - RUN: npx vitest run (full suite — no regression).
  - EXPECTED: all clean. If coverage <100% on session-utils.ts, one of the worker branches is unhit —
        add the matching case from Task 3 (esp. stat-non-ENOENT via chmod 000 on Linux, if needed).
```

### Implementation Patterns & Key Details

```ts
// ---- src/core/session-utils.ts (APPEND after resolveIncludes) ----

// Mirrors S1's module-private INCLUDE_TOKEN (re-declared here because S1's const is not exported).
const RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;

/**
 * Recursively expand `@token` includes in `content` (PRD §2.3).
 *
 * Path-based visited set → cycle-safe yet diamond-safe. Depth-bounded by maxDepth.
 * baseDir is the ENTRY PRD's directory (never re-derived). Internal helper of resolvePRD.
 */
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>
): Promise<string> {
  if (depth >= maxDepth) {
    return content; // depth gate — remaining @tokens stay literal
  }

  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
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
          childVisited
        );
      }
      // else: directory → not a file → replacement stays undefined (silent verbatim).
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        replacement = undefined; // missing → silent verbatim (S3 adds the .md stderr warning)
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

export async function resolvePRD(
  prdPath: string,
  opts?: ResolveOpts
): Promise<string> {
  const absEntry = resolve(prdPath);
  const baseDir = dirname(absEntry); // project-root-relative base invariant (PRD §2.3)
  const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();

  logger().debug({ prdPath: absEntry, baseDir, maxDepth }, 'Resolving PRD includes');

  const entryContent = await readUTF8FileStrict(absEntry, 'read PRD');
  // Seed visited with the entry so an include pointing back at the entry is a cycle.
  return expandIncludesRecursive(
    entryContent,
    baseDir,
    maxDepth,
    0,
    new Set<string>([absEntry])
  );
}

// ---- tests/unit/core/prd-resolve.test.ts (NEW — key assertions) ----
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePRD, SessionFileError } from '../../../src/core/session-utils.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'prd-resolve-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

it('recursively expands a nested chain', async () => {
  writeFileSync(join(tmp, 'c.md'), 'C');
  writeFileSync(join(tmp, 'b.md'), 'B(@c.md)');
  writeFileSync(join(tmp, 'a.md'), 'A(@c.md via b:@b.md)');
  writeFileSync(join(tmp, 'main.md'), 'start @a.md end');
  await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
    'start A(@c.md via b:B(C)) end'
  );
});

it('terminates a self-cycle leaving the back-edge literal', async () => {
  writeFileSync(join(tmp, 'a.md'), 'X @a.md Y');
  writeFileSync(join(tmp, 'main.md'), '@a.md');
  // a.md includes itself → the inner @a.md stays literal (cycle); no throw, no infinite loop.
  await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('X @a.md Y');
});

it('expands a diamond in both branches (path-based visited set)', async () => {
  writeFileSync(join(tmp, 'shared.md'), 'S');
  writeFileSync(join(tmp, 'a.md'), '[@shared.md]');
  writeFileSync(join(tmp, 'b.md'), '{@shared.md}');
  writeFileSync(join(tmp, 'main.md'), '@a.md\n@b.md');
  const out = await resolvePRD(join(tmp, 'main.md'));
  // shared appears TWICE (once per branch) — a flat set would wrongly deduplicate.
  expect(out).toBe('[S]\n{S}');
});

it('resolves includes against the ENTRY PRD directory (base invariant)', async () => {
  mkdirSync(join(tmp, 'sub'));
  writeFileSync(join(tmp, 'shared.md'), 'SHARED_AT_ROOT'); // NOTE: at <tmp>/shared.md, NOT <tmp>/sub/
  writeFileSync(join(tmp, 'sub', 'a.md'), 'sub-file refs @shared.md');
  writeFileSync(join(tmp, 'main.md'), '@sub/a.md');
  // @shared.md inside sub/a.md resolves to <tmp>/shared.md (entry dir), not <tmp>/sub/shared.md.
  await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe('sub-file refs SHARED_AT_ROOT');
});

it('stops expanding at opts.maxDepth', async () => {
  writeFileSync(join(tmp, 'c.md'), 'C');
  writeFileSync(join(tmp, 'b.md'), 'B@b_inner @c.md'); // (b_inner won't exist)
  writeFileSync(join(tmp, 'a.md'), 'A @b.md');
  writeFileSync(join(tmp, 'main.md'), '@a.md');
  // maxDepth=1: only a.md expands; b's @b.md is read but NOT recursed (b's contents stay literal).
  // (Adjust the exact expected string to your fixture; the key assertion is depth-bounded behavior.)
  const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });
  expect(out).toContain('A ');          // a.md expanded (depth 0→1)
  expect(out).toContain('@c.md');       // c NOT expanded (depth 1 is the gate)
});

it('rejects a missing entry file with SessionFileError', async () => {
  await expect(resolvePRD(join(tmp, 'nope.md'))).rejects.toBeInstanceOf(SessionFileError);
});
```

### Integration Points

```yaml
DOWNSTREAM (S2 ENABLES these — do NOT do them here):
  - P1.M1.T1.S3 (markers/idempotency/warnings): extends ResolveOpts with markers?: boolean, reads
        PRD_INCLUDE_MARKERS, wraps the worker's substitution site with <!-- @include: path --> /
        <!-- @end-include -->, and emits the stale-include .md-token stderr warning. S2's worker is
        structured with a single `out += replacement ?? m[0];` site for exactly this.
  - P1.M1.T2.S1/S2 (wiring): threads resolvePRD's output through hashPRD, snapshot, createDeltaSession,
        findSessionByHash, handleDelta. S2 only PROVIDES resolvePRD; it does not call it from those paths.

NO OTHER INTEGRATION in S2: no CLI, no pipeline, no agent. resolvePRD is a pure (prdPath) → resolved-
  string function consumed later. resolveIncludes (S1) stays exported + tested unchanged.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first; nested try/catch + JSDoc may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused vars; every param must be used)
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags the worker params, ensure each is read
# (content/baseDir/maxDepth/depth/visited all are). If typecheck fails on the regex, confirm
# the lookbehind syntax matches S1's exactly.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass + cover 100% of the new lines in session-utils.ts):
npx vitest run tests/unit/core/prd-resolve.test.ts
# S1 regression — single-level suite must stay green (S2 only ADDS exports):
npx vitest run tests/unit/core/prd-includes.test.ts
# Coverage check on the touched source file:
npx vitest run tests/unit/core/prd-resolve.test.ts tests/unit/core/prd-includes.test.ts --coverage
# Expected: prd-resolve green; prd-includes green; session-utils.ts new lines at 100%.
# If a branch is uncovered, add the matching real-tmpdir case (Task 1 cases 1–13).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2 — resolvePRD is a pure function; it is not yet wired into the pipeline (that is
# P1.M1.T2). Smoke-test it directly against a real nested multi-file PRD layout:
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.ts';
const d = mkdtempSync(join(tmpdir(), 'inc-'));
writeFileSync(join(d, 'c.md'), 'C');
writeFileSync(join(d, 'b.md'), 'B @c.md');
writeFileSync(join(d, 'a.md'), 'A @b.md');
writeFileSync(join(d, 'main.md'), '@a.md');
resolvePRD(join(d, 'main.md')).then(r => { console.log(JSON.stringify(r)); rmSync(d, { recursive: true, force: true }); });
"
# Expected output: "A B C" (the chain @a.md → @b.md → @c.md fully expanded inline, recursively).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Self-cycle (a→a) and mutual cycle (a→b→a) terminate; back-edge @token stays literal; no throw.
#   - Diamond (a→c, b→c) expands c in BOTH branches (path-based visited set, not flat).
#   - Base invariant: @token in sub/a.md resolves to <entryDir>/token, NOT <entryDir>/sub/token.
#   - Depth gate: opts.maxDepth=N stops after N nesting levels; deeper tokens stay literal.
#   - Entry-read failure → SessionFileError; missing/dir/cycle → silent verbatim (S3 adds warnings).
#   - resolveIncludes (S1) is UNCHANGED — prd-includes.test.ts still green (single-level behavior intact).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused vars on worker params).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts` green.
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts` green (S1 regression).
- [ ] `npx vitest run` (full suite) green — no regression.
- [ ] Touched lines in `src/core/session-utils.ts` at 100% coverage.

### Feature Validation
- [ ] Nested chain (entry→a→b→c) fully expands inline.
- [ ] Self-cycle (a→a) terminates; back-edge literal; no throw.
- [ ] Mutual cycle (a→b→a) terminates; back-edge literal; no throw.
- [ ] Diamond (entry→a→c, entry→b→c) expands `c` in BOTH branches.
- [ ] Base invariant: sub-directory `@token` resolves against the ENTRY PRD's directory.
- [ ] Depth beyond `opts.maxDepth` / default stops expanding; deeper tokens literal.
- [ ] Entry ENOENT / invalid-UTF-8 → `SessionFileError`; missing/dir/cycle → silent verbatim.

### Code Quality Validation
- [ ] Only ADDS to `session-utils.ts` (append resolvePRD + module-private worker); no S1 export modified.
- [ ] Reuses `readUTF8FileStrict` / `SessionFileError` / `stat` / `resolve` / `dirname` / `logger()` /
      `getPrdIncludeMaxDepth` (no reinvention).
- [ ] Visited set is PATH-BASED (`new Set(visited).add(abs)` per branch) — diamond-safe.
- [ ] `baseDir` computed once from `dirname(resolve(prdPath))`, passed unchanged.
- [ ] Re-declared regex IDENTICAL to S1's INCLUDE_TOKEN (one-line contract).
- [ ] No markers / stale-include warnings (S3); no wiring into hash/snapshot/delta (P1.M1.T2).
- [ ] Real-tmpdir test file (NOT vi.mock fs); separate from S1's prd-includes.test.ts.

### Documentation & Deployment
- [ ] JSDoc on `resolvePRD` documents recursion, path-based cycle detection, max depth, and the
      project-root-relative base invariant; cites PRD §2.3.
- [ ] Commit message notes: true recursion (not fixpoint); path-based visited set; base invariant;
      markers=S3; wiring=P1.M1.T2; resolveIncludes (S1) unchanged.

---

## Anti-Patterns to Avoid

- ❌ Don't use a FLAT/global visited set — it deduplicates diamond includes wrongly. Copy the set per
      branch (`new Set(visited).add(abs)`) for path-based (diamond-safe) cycle detection.
- ❌ Don't re-derive `baseDir` from an included file's location — it's the ENTRY PRD's directory,
      fixed once and passed unchanged (PRD §2.3 base invariant).
- ❌ Don't implement recursion as fixpoint iteration of `resolveIncludes` — it cannot provide the
      contract's explicit visited-Set cycle detection (resolveIncludes is a single-level black box).
      Use the recursive worker.
- ❌ Don't modify S1's `resolveIncludes`, `ResolveOpts`, `INCLUDE_TOKEN`, or any constant — append only.
      (Re-declare the identical regex in the worker; do NOT add `export` to S1's private const.)
- ❌ Don't emit `<!-- @include -->` markers or stale-include warnings — that's S3. (Keep the worker's
      substitution site a single line so S3 can wrap it.)
- ❌ Don't add a `markers` field to `ResolveOpts` — S3 owns it (collision-free).
- ❌ Don't wire `resolvePRD` into `hashPRD`/snapshot/delta/pipeline — that's P1.M1.T2.
- ❌ Don't use `readFile` directly — reuse `readUTF8FileStrict` (strict UTF-8 + `SessionFileError`).
- ❌ Don't re-serialize unexpanded tokens — fall back to the original match text `m[0]` (idempotency-friendly).
- ❌ Don't add resolvePRD tests to the mocked `session-utils.test.ts` or to S1's `prd-includes.test.ts` —
      use a NEW real-tmpdir file `prd-resolve.test.ts`.
- ❌ Don't skip the error-branch tests — vitest enforces 100%; cover ENOENT, directory, stat-EACCES
      (chmod 000 on Linux), read-fail (invalid UTF-8), and entry-read-fail.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: The S1 surface S2 consumes is ALREADY LANDED and verified in-repo (resolveIncludes,
ResolveOpts, getPrdIncludeMaxDepth, stat/dirname imports all present). The algorithm is small
(~40 lines), self-contained, and fully specified with exact code. The two non-obvious design
decisions — (a) true recursion over fixpoint (because the contract mandates a visited Set),
and (b) path-based (diamond-safe) visited set — are documented with rationale and worked
examples, and reconciled with S1's integration note. The test strategy is concrete (13 real-
tmpdir cases mapping 1:1 to coverage branches, including the critical base-invariant and
diamond proofs). Scope boundaries with S1/S3/P1.M1.T2 are explicit. Residual risks: (a) a
prettier nit on the nested worker (auto-fixed via `npm run fix`), (b) an exact-string
assertion needing a tweak to match the fixture (the maxDepth case's expected string is flagged
"adjust to your fixture"), and (c) the stat-EACCES branch possibly needing a chmod-000 case on
Linux if coverage flags it (recipe provided). No external/runtime unknowns.