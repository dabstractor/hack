# PRP — P1.M1.T1.S3: Idempotency guarantee, optional markers, and stale-include warnings

> Builds on S1's `resolveIncludes` + the `PRD_INCLUDE_MARKERS` config name (LANDED) and S2's
> `resolvePRD` + recursive worker (CONTRACT — assume LANDED). S3 = (1) **EXTEND** `ResolveOpts`
> with `markers?: boolean`, (2) add a `getPrdIncludeMarkers()` boolean getter to constants,
> (3) wrap expanded includes with `<!-- @include: path -->` / `<!-- @end-include -->` markers when
> enabled, (4) emit a **stderr** `console.warn` for stale `.md` tokens, and (5) **lock in
> idempotency** (`resolve(resolve(x)) === resolve(x)`) with tests. **Recursion/cycle/depth = S2
> (already landed). Wiring into hash/snapshot/delta = P1.M1.T2 (not S3).**

---

## Goal

**Feature Goal**: Complete PRD §2.3's resolver by layering three behaviors onto S2's landed
`resolvePRD`/`expandIncludesRecursive`: (a) an **idempotency guarantee** verified by tests
(re-resolving the resolved document yields identical bytes), (b) **optional include markers**
gated by `PRD_INCLUDE_MARKERS` env / `opts.markers` (wrap each expanded include in
`<!-- @include: path -->` … `<!-- @end-include -->`), and (c) a **stale-include stderr warning**
when a `.md` token matches the boundary rule but its path doesn't resolve to an existing file.

**Deliverable**:
1. **`src/config/constants.ts`** — append `getPrdIncludeMarkers(): boolean` (the FIRST boolean env
   getter in the file; reads `PRD_INCLUDE_MARKERS`, truthy except empty/`0`/`false`/`no`/`off`).
2. **`src/core/session-utils.ts`** — MODIFY (assume S2 landed): add `markers?: boolean` to the
   exported `ResolveOpts` interface; thread a `markers` flag from `resolvePRD` into
   `expandIncludesRecursive`; emit the stale-include `console.warn`; wrap substitutions with
   markers when enabled.
3. **`tests/unit/core/prd-markers.test.ts`** — NEW real-tmpdir test file (distinct from S1's
   `prd-includes.test.ts` and S2's `prd-resolve.test.ts`) covering markers (on/off/override),
   stale-include warnings (`.md` vs non-`.md`, cycle excluded, directory, no-double-warn noise),
   idempotency (markers off, markers on, stale survivors), inline vs line-start expansion, and the
   new `getPrdIncludeMarkers()` getter branches.
4. **Docs (Mode A)** — JSDoc on `resolvePRD` documenting the idempotency property, the
   `markers`/`PRD_INCLUDE_MARKERS` toggle, the marker format, and the stale-include warning.

**Success Definition**:
- `resolve(resolve(x)) === resolve(x)` (byte-for-byte) for every within-depth fixture — with
  markers OFF and with markers ON.
- `PRD_INCLUDE_MARKERS=1` (or `opts.markers=true`) wraps each expanded include as
  `<!-- @include: docs/a.md -->\n<body>\n<!-- @end-include -->`; `opts.markers=false` overrides an
  env `=1`; unset → no markers.
- A stale `@docs/missing.md` token (file absent, or a directory) emits exactly ONE
  `console.warn(...)` to stderr PER resolve pass AND stays verbatim in output; a missing
  `@missing.txt` (non-`.md`) and a cycle back-edge `@a.md` emit NO warning.
- `npm run typecheck && npm run lint && npm run format:check` clean; the new test file passes;
  touched lines in `session-utils.ts` and `constants.ts` at 100% coverage; S1 (`prd-includes.test.ts`)
  and S2 (`prd-resolve.test.ts`) suites stay green.

---

## Why

- **Idempotency is the hash/snapshot invariant (PRD §2.3).** The PRD explicitly mandates
  "Re-resolving already-resolved content MUST yield identical bytes" because hashing (§4.1),
  delta detection (§4.3), and `prd_snapshot.md` all run over the fully-resolved document. S3 makes
  that property *tested* (S1/S2 achieve it by construction for the normal case; S3 locks it in and
  proves markers don't break it).
- **Markers enable debugging + tooling.** With `PRD_INCLUDE_MARKERS`, a human or a diff tool can
  see *where* inlined content came from — essential for reviewing resolved multi-file PRDs without
  losing provenance. PRD §2.3 fixes the exact marker pair so tooling is stable.
- **Stale-include warnings surface silent breakage.** A typo'd `@docs/arhc.md` currently expands to
  nothing (silent verbatim in S1/S2). The `.md`-only stderr warning turns a silent failure into a
  visible one — without spamming on ordinary prose `@mentions` (non-`.md`) or intentional includes.
- **Scope discipline.** S3 does NOT touch S1's `resolveIncludes` internals, does NOT re-implement
  S2's recursion/cycle/depth logic (it edits S2's landed worker at well-defined sites), and does
  NOT wire `resolvePRD` into hash/snapshot/delta (P1.M1.T2).

---

## What

### User-visible behavior
None directly (a load-time resolver). Indirectly, once P1.M1.T2 wires it: setting
`PRD_INCLUDE_MARKERS=1` makes the canonical document visibly annotate each inlined section, and a
broken `@docs/missing.md` prints a warning on stderr at load time while still producing a valid
document.

### Technical requirements (exact contract)

**File 1 — `src/config/constants.ts`** (append; mirror the `getPrdIncludeMaxDepth()` JSDoc shape):
```ts
/**
 * Read & validate the `PRD_INCLUDE_MARKERS` env var (PRD §2.3; S3).
 *
 * @remarks
 * Truthy unless unset/empty or one of the common "off" spellings (`'0'`, `'false'`, `'no'`,
 * `'off'`, case-insensitive, surrounding whitespace trimmed). Value is compared case-insensitively
 * AFTER `trim().toLowerCase()`; any other non-empty value → `true`. This is the first boolean
 * env getter in this module.
 *
 * @returns `true` iff markers should be emitted around expanded includes.
 */
export function getPrdIncludeMarkers(): boolean {
  const raw = process.env[PRD_INCLUDE_MARKERS];
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}
```
(`PRD_INCLUDE_MARKERS` name-const already exists from S1 at line ~353 — do NOT redeclare it.)

**File 2 — `src/core/session-utils.ts`** (MODIFY the S2-landed code; do NOT recreate it):

(a) Extend `ResolveOpts` (S1 reserved this exact field): add inside the interface
```ts
  /**
   * When `true`, wrap each expanded include with `<!-- @include: path -->` / `<!-- @end-include -->`
   * markers (PRD §2.3). Defaults to {@link getPrdIncludeMarkers} (the `PRD_INCLUDE_MARKERS` env var).
   * Pass `false` explicitly to suppress markers even when the env var is set.
   */
  markers?: boolean;
```

(b) `resolvePRD` — compute the flag once and pass it down:
```ts
const markers = opts?.markers ?? getPrdIncludeMarkers();   // ADD after maxDepth line
// … pass `markers` as the new last arg to expandIncludesRecursive(…)
```
Add `getPrdIncludeMarkers` to the existing `import { getPrdIncludeMaxDepth } from '../config/constants.js';`
line (one import key — do NOT add a second import line).

(c) `expandIncludesRecursive` — add a trailing `markers: boolean` parameter AND thread it into the
recursive self-call. At the substitution site (currently `out += replacement ?? m[0];`) REPLACE with:
```ts
    // S3: stale-include warning — .md token that matched boundary but didn't resolve to a file
    //     (ENOENT or a directory). Cycle back-edges `continue`d above; depth-exceeded returned early.
    if (replacement === undefined && token.endsWith('.md')) {
      console.warn(
        `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
      );
    }
    // S3: optional include markers around expanded content (PRD §2.3).
    out +=
      markers && replacement !== undefined
        ? `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`
        : (replacement ?? m[0]);
```

### Stale-warning + marker rules (the spec — implement exactly)

| Concern | Rule |
| --- | --- |
| MARKERS | On iff `opts?.markers ?? getPrdIncludeMarkers()` is `true`. Each EXPANDED include (every depth) is wrapped as `<!-- @include: <token> -->\n<body>\n<!-- @end-include -->` where `<token>` is the original matched path (e.g. `docs/a.md`). Tokens that stay literal (missing/dir/cycle/depth) are NEVER wrapped. |
| STALE WARNING | Fires iff: token matched boundary AND `replacement === undefined` (ENOENT or directory) AND `token.endsWith('.md')`. Emitted via `console.warn` (→ **stderr**, sync). The token stays verbatim in output. Cycles (file exists) and depth-exceeded (not scanned) and non-`.md` missing tokens emit NO warning. |
| IDEMPOTENCY | For any within-depth fixture: `resolvePRD` applied twice to its own output yields byte-identical results. Survivors (missing/dir/cycle) re-fail identically; marker `@include`/`@end-include` words are not real `.md` files so survive unchanged. |

### Success Criteria
- [ ] `ResolveOpts.markers?: boolean` exported (S1's reserved field now present).
- [ ] `getPrdIncludeMarkers()` exported from `constants.ts`: unset/empty/`0`/`false`/`no`/`off` →
      `false`; any other non-empty value (e.g. `1`, `true`, `yes`, `ON`, ` 1 `) → `true`.
- [ ] `PRD_INCLUDE_MARKERS=1` wraps each expanded include in the exact marker pair; nested includes
      are wrapped at every depth.
- [ ] `opts.markers=false` suppresses markers even when `PRD_INCLUDE_MARKERS=1`; `opts.markers=true`
      emits markers even when env unset.
- [ ] A missing `@docs/missing.md` emits ONE `console.warn` per pass and stays literal; a missing
      `@x.txt` and a cycle back-edge `@a.md` emit NONE.
- [ ] `resolve(resolve(x)) === resolve(x)` byte-for-byte for within-depth fixtures (markers off AND on).
- [ ] Line-start AND inline/parenthesized expansions both wrap correctly when markers on.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.
- [ ] New test file passes; touched `session-utils.ts` + `constants.ts` lines at 100% coverage;
      `prd-includes.test.ts` (S1) + `prd-resolve.test.ts` (S2) still green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — the exact S1+S2 surface to consume/modify (verified in-repo with
line numbers), the full marker/stale-warning/idempotency algorithm with rationale, the
stdout-vs-stderr logger finding (why `console.warn`, not the logger), the marker-format
self-protection proof, the per-branch test recipes that map 1:1 to coverage, and the executable
validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the S2 CONTRACT (resolvePRD + worker S3 modifies). S2 lands BEFORE S3.
- file: plan/008_15504f60a0ef/P1M1T1S2/PRP.md
  why: Defines resolvePRD + expandIncludesRecursive (the recursive worker). S3 EDITS these — adds
        a `markers` param, the stale-warning, and marker-wrapping at the worker's substitution site
        (`out += replacement ?? m[0];`). The cycle branch (`continue`) and depth gate
        (`if (depth>=maxDepth) return content`) are S2's and MUST be preserved unchanged.
  critical: S3 must NOT recreate resolvePRD/worker. It MODIFIES S2's landed code: add param,
        thread it into the recursive self-call, and replace the single substitution line.

# MUST READ — design decisions (authored with this PRP)
- docfile: plan/008_15504f60a0ef/P1M1T1S3/research/idempotency-markers-design.md
  section: "1. THE key decision: where the stderr warning goes" and "2. Idempotency analysis" and
        "3. Why markers do NOT break idempotency" and "6. Test file isolation"
  why: Proves the pino logger writes to STDOUT (so S3 MUST use console.warn for stderr), proves
        idempotency holds for within-depth fixtures, proves the marker format is self-protecting
        against re-expansion, and pins the distinct test filename. READ BEFORE IMPLEMENTING.

# MUST READ — PRD spec (verbatim rules)
- docfile: PRD.md
  section: "§2.3 Distributed (Multi-File) PRDs" (esp. "Idempotency" + "Markers (optional)")
  why: Authoritative idempotency + marker-format + stale-warning rules. (Also inline in this PRP's
        <selected_prd_content>.)

# MUST READ — S1 LANDED surface (verified in-repo)
- file: src/core/session-utils.ts
  why: S1's resolveIncludes (:333) + ResolveOpts (:287, has `// (S3 will extend … markers?)`)
        + INCLUDE_TOKEN (:282, module-private) + readUTF8FileStrict (:209) + SessionFileError (:64)
        + lazy logger() (:38) + `import { stat } from 'node:fs/promises'` (:24, S1 added) +
        `import { resolve, join, dirname, basename } from 'node:path'` (:34). S2 APPENDED resolvePRD
        + the module-private worker after resolveIncludes. S3 EDITS those + ResolveOpts.
  critical: Add `getPrdIncludeMarkers` to the EXISTING constants import line (one key). Do NOT add
        `markers` to resolveIncludes (S1 single-level stays marker-less) — markers apply only via
        resolvePRD/the recursive worker.

- file: src/config/constants.ts
  why: S1 LANDED PRD_INCLUDE_MARKERS (:353, name-only const) + getPrdIncludeMaxDepth (:325, the
        numeric-getter JSDoc pattern to MIRROR for the new boolean getter). S3 APPENDS
        getPrdIncludeMarkers() — the FIRST boolean getter in the file.
  pattern: "export function getX(): T { const raw = process.env[X]; …; return …; }" with full JSDoc.

- file: src/utils/logger.ts
  why: PROOF the logger writes to stdout (buildRoot(): JSON→`pino({...})` default=stdout; pretty→
        `pino({...}, pretty({...}))` default=stdout). This is WHY S3 uses console.warn for the
        stderr warning instead of logger().warn. (See research note §1.)

# PATTERN FILES
- file: src/utils/verify-groundswell-version.ts   # console.warn precedent
  why: PROVES console.warn is an accepted production-code diagnostic in THIS repo (:964, :1016).
        `no-console` is OFF in .eslintrc.json. Node's console.warn → process.stderr (sync).
  pattern: "console.warn(`…: ${error}`)"

- file: tests/unit/core/prd-includes.test.ts      # S1's REAL-tmpdir style to MIRROR
  why: S1's real-tmpdir scaffolding (mkdtempSync/writeFileSync/mkdirSync/rmSync + vi.stubEnv for
        getter cases). S3 MIRRORS this style in a SEPARATE file (prd-markers.test.ts).
  gotcha: Do NOT add S3 cases to prd-includes.test.ts (S1, landed) or prd-resolve.test.ts (S2,
        parallel). Create prd-markers.test.ts.

- file: tests/unit/config/research-timeout.test.ts # env-stub getter-test precedent
  why: Pattern for stubbing env vars with vi.stubEnv + vi.unstubAllEnvs in afterEach. S3 reuses this
        for the getPrdIncludeMarkers getter cases inside prd-markers.test.ts.
```

### Current Codebase tree (relevant slice)

```bash
src/config/constants.ts          # S1 owns (landed) — S3 APPENDS getPrdIncludeMarkers()
src/core/session-utils.ts        # S1 (landed) + S2 (contract) — S3 EDITS resolvePRD/worker/ResolveOpts
tests/unit/core/
├── session-utils.test.ts        # UNCHANGED (vi.mock fs style — leave as-is)
├── prd-includes.test.ts         # S1 (landed) — DO NOT TOUCH
├── prd-resolve.test.ts          # S2 (parallel) — DO NOT TOUCH
└── prd-markers.test.ts          # ← S3 CREATES (markers + stale warning + idempotency + getter)
```

### Desired Codebase tree with files to be added/edited

```bash
src/config/constants.ts          # MODIFIED (append getPrdIncludeMarkers)
src/core/session-utils.ts        # MODIFIED (ResolveOpts.markers + resolvePRD/worker edits)
tests/unit/core/prd-markers.test.ts   # NEW
```
(`.env.example` and `docs/CONFIGURATION.md` already have the PRD rows from S1 — NO edits needed.)

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 EDITS S2's landed resolvePRD + expandIncludesRecursive; it does NOT recreate them.
//   Add `markers: boolean` as the LAST param of the worker, thread it into the recursive self-call
//   (expandIncludesRecursive(child, baseDir, maxDepth, depth+1, childVisited, markers)), and replace
//   the single `out += replacement ?? m[0];` line with the stale-warn + marker-wrap block. Preserve
//   S2's cycle branch (`continue`) and depth gate (`if (depth>=maxDepth) return content`) UNCHANGED.

// CRITICAL — the stale-include warning MUST go to STDERR. The pino logger writes to STDOUT for both
//   modes (verified in logger.ts buildRoot). Use console.warn (→ process.stderr, sync; precedent in
//   verify-groundswell-version.ts). Do NOT use logger().warn for this warning.

// CRITICAL — add `markers?: boolean` to ResolveOpts (S1 reserved it with a comment). Add
//   `getPrdIncludeMarkers` to the EXISTING `import { getPrdIncludeMaxDepth } from '../config/constants.js'`
//   line — do NOT add a second import line.

// CRITICAL — markers apply ONLY via resolvePRD/the recursive worker. Do NOT add marker logic to S1's
//   single-level resolveIncludes (it stays marker-less; its test suite must remain green unchanged).

// CRITICAL — the stale-warning guard is `replacement === undefined && token.endsWith('.md')`. Place
//   it AFTER the try/catch (where replacement's fate is known) and BEFORE the substitution. It is
//   NOT reached for cycles (they `continue` earlier) or depth-exceeded (the gate returns earlier).

// CRITICAL — marker wrapping is `markers && replacement !== undefined ? wrapped : (replacement ?? m[0])`.
//   NEVER wrap a literal survivor (missing/dir/cycle/depth) — only successfully-expanded content.

// CRITICAL — lint: @typescript-eslint/no-unused-vars ignores ONLY `^_` params. The new `markers`
//   worker param MUST be read (it is, at the substitution site). ResolveOpts.markers is read in
//   resolvePRD. getPrdIncludeMarkers is read in resolvePRD. All used — no unused-var errors.

// CRITICAL — prettier is ERROR-enforced (prettier/prettier: error). Run `npm run fix`
//   (lint:fix + prettier --write) before format:check. The template literal + ternary may need it.

// CRITICAL — vitest.config.ts enforces 100% coverage (statements/branches/functions/lines) on
//   src/**/*.ts. S3 adds branches that ALL need coverage:
//     - opts?.markers ?? getPrdIncludeMarkers()  → opts.markers true / false / undefined(3)
//     - markers && replacement!==undefined       → wrap / no-wrap-with-content / no-wrap-literal(3)
//     - replacement===undefined && token.endsWith('.md') → warn / no-warn-non-md / no-warn-resolved(3)
//     - getPrdIncludeMarkers: undefined / '' / '0' / 'false' / 'no' / 'off' / truthy (7)
//   The test cases in Task 3 map 1:1 to these branches.

// GOTCHA — idempotency: S3's tests use WITHIN-DEPTH fixtures (default maxDepth=10; chains fully
//   resolve). Depth-exceeded is a deliberate safety-valve truncation that is intentionally NOT a
//   fixed point — do NOT write an idempotency test that relies on depth truncation (it would fail
//   by design). See research note §2.

// GOTCHA — marker format is `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`
//   (note: `${token}` is the ORIGINAL matched path, e.g. `docs/a.md`, NOT the absolute path).
//   The format is self-protecting against re-expansion: `@include` captures `include` (stops at
//   `:`), `@end-include` captures `end-include` — neither is a real `.md` file, so re-resolve
//   leaves them literal. The real path after `@include: ` has no `@` prefix → not a token. (§3.)

// GOTCHA — to keep idempotency tests clean (no console noise + no double-warn flakiness), spy on
//   console.warn with `vi.spyOn(console, 'warn').mockImplementation(() => {})` in those tests.

// GOTCHA — Node 20+ / target ES2022 (tsconfig.json): lookbehind regex fine; template literals fine.
//   module NodeNext → keep `.js` extensions in relative imports.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// src/core/session-utils.ts — EXTEND S1's ResolveOpts (S1 reserved this exact field)
export interface ResolveOpts {
  maxDepth?: number;
  /** Wrap expanded includes with markers (PRD §2.3; S3). Defaults to getPrdIncludeMarkers(). */
  markers?: boolean;
}

// src/config/constants.ts — APPEND (first boolean getter)
export function getPrdIncludeMarkers(): boolean;

// src/core/session-utils.ts — MODIFY S2's worker signature (add trailing param)
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>,
  markers: boolean,            // ← S3 adds (LAST param; thread into recursive self-call)
): Promise<string>;
```

### Implementation Tasks (ordered by dependencies — implicit TDD: RED first, then GREEN)

```yaml
Task 1: CREATE tests/unit/core/prd-markers.test.ts   (RED — must fail before impl)
  - IMPORT: resolvePRD, ResolveOpts, SessionFileError from '../../../src/core/session-utils.js';
        getPrdIncludeMarkers, PRD_INCLUDE_MARKERS from '../../../src/config/constants.js';
        vitest primitives (describe/it/expect/beforeEach/afterEach/vi); node:fs
        (mkdtempSync/writeFileSync/mkdirSync/rmSync), node:os tmpdir, node:path join.
  - STRUCTURE: describe('resolvePRD — markers, stale warnings, idempotency') with
        beforeEach(mkdtempSync) + afterEach(rmSync recursive + vi.unstubAllEnvs). REAL tmpdir —
        NO vi.mock('node:fs/promises'). Mirror S1's prd-includes.test.ts scaffolding.
  - MARKERS CASES:
      1. default (env unset) → NO markers: entry '@a.md', a='A' → result 'A' (no <!-- @include -->).
      2. PRD_INCLUDE_MARKERS=1 → wrapped: result === '<!-- @include: a.md -->\nA\n<!-- @end-include -->'.
      3. opts.markers=true (env unset) → wrapped (same exact string as case 2).
      4. opts.markers=false overrides env=1: vi.stubEnv(PRD_INCLUDE_MARKERS,'1'); call with
         {markers:false} → NO markers (proves opts wins).
      5. nested wrap: entry '@a.md', a='@b.md', b='B', markers on → BOTH levels wrapped; assert
         result contains '<!-- @include: a.md -->' AND '<!-- @include: b.md -->'.
      6. literal survivor NOT wrapped: entry '@missing.md' (file absent), markers on → output is
         literal '@missing.md' with NO '<!-- @include' (never wrap a non-expansion).
      7. inline vs line-start both wrap: entry 'see @a.md here' and '@a.md' fixtures → both wrap
         the expansion identically; surrounding prose preserved.
  - STALE-WARNING CASES (spy console.warn in each):
      8. stale .md missing: entry '@missing.md' → console.warn called once with a message containing
         'missing.md'; output still contains literal '@missing.md'. (vi.spyOn(console,'warn').mockImpl)
      9. non-.md missing: entry '@missing.txt' (absent) → console.warn NOT called; output literal.
      10. cycle back-edge NOT warned: a='@a.md' (self-cycle via entry) → the back-edge '@a.md' stays
          literal; console.warn NOT called (file exists → not stale). (May need resolvePRD on a.md.)
      11. directory .md token: mkdirSync 'docs.md' (a DIRECTORY named docs.md); entry '@docs.md' →
          console.warn called (path doesn't resolve to a FILE); output literal. Covers isFile-false
          + .md stale branch together.
      12. resolved .md NOT warned: entry '@a.md', a exists → console.warn NOT called.
  - IDEMPOTENCY CASES (mock console.warn to silence):
      13. markers OFF idempotent: entry '@a.md', a='@b.md', b='B' (within default depth). resolve
          once → r1; resolve(r1) by writing r1 to a temp file + resolvePRD(tempFile) → r2.
          assert r1 === r2 byte-for-byte.
      14. markers ON idempotent: same fixture, markers on. r1 = resolve(with markers); write r1 to
          temp; r2 = resolve(r1, {markers:true}); assert r1 === r2 (proves @include/@end-include
          survive re-resolve unchanged — research note §3).
      15. stale-survivor idempotent: entry '@real.md @missing.md', real='R'. r1 has 'R' (expanded)
          + '@missing.md' (literal). r2 = resolve(r1). assert r1 === r2 (missing re-fails → same
          bytes). console.warn mocked.
  - GETTER CASES (describe('getPrdIncludeMarkers'), use vi.stubEnv + afterEach vi.unstubAllEnvs):
      16. unset → false; '' → false; '0' → false; 'false' → false; 'no' → false; 'off' → false;
          'FALSE' → false (case-insensitive); ' 0 ' → false (trimmed).
      17. '1' → true; 'true' → true; 'yes' → true; 'on' → true; 'ON' → true; 'enable' → true;
          ' 1 ' → true (trimmed). (Mirrors research-timeout.test.ts env-stub style.)
  - NAMING: it('wraps expanded includes when PRD_INCLUDE_MARKERS is set'),
        it('emits a stderr warning for a stale .md token'), it('is idempotent with markers on'), etc.
  - PLACEMENT: tests/unit/core/prd-markers.test.ts (distinct from S1's + S2's files).
  - EXPECTED NOW: getPrdIncludeMarkers import fails + ResolveOpts.markers absent → RED.

Task 2: EDIT src/config/constants.ts — append getPrdIncludeMarkers() (GREEN for getter cases)
  - APPEND after PRD_INCLUDE_MARKERS const (line ~353): the boolean getter (exact code in
        "Technical requirements"). Reuse the existing PRD_INCLUDE_MARKERS name-const (do NOT
        redeclare). Mirror getPrdIncludeMaxDepth's JSDoc style.
  - DO NOT modify PRD_INCLUDE_MARKERS / PRD_INCLUDE_MAX_DEPTH / getPrdIncludeMaxDepth / any S1 export.

Task 3: EDIT src/core/session-utils.ts — markers + stale warning + ResolveOpts (GREEN)
  - ADD `getPrdIncludeMarkers` to the existing `import { getPrdIncludeMaxDepth } from '../config/constants.js'`
        line (one key; S1 already imports getPrdIncludeMaxDepth — confirm and extend).
  - EXTEND ResolveOpts: add `markers?: boolean` with JSDoc (S1's reserved comment → real field).
  - MODIFY resolvePRD: add `const markers = opts?.markers ?? getPrdIncludeMarkers();` after the
        maxDepth line; pass `markers` as the new last arg to expandIncludesRecursive.
  - MODIFY expandIncludesRecursive: add trailing `markers: boolean` param; thread it into the
        recursive self-call; REPLACE the `out += replacement ?? m[0];` line with the stale-warn +
        marker-wrap block (exact code in "Technical requirements").
  - PRESERVE S2's cycle branch + depth gate + path-based visited set + base invariant UNCHANGED.
  - DO NOT add marker/stale-warning logic to S1's resolveIncludes (single-level; stays as-is).
  - EXPECTED: prd-markers.test.ts cases 1–17 turn GREEN; 100% coverage of the new/edited lines.

Task 4: EDIT docs (Mode A — JSDoc only)
  - UPDATE resolvePRD's JSDoc: document (a) the IDEMPOTENCY property ("re-resolving within-depth
        output yields identical bytes; the basis for §4.1 hash / §4.3 delta / snapshot consistency"),
        (b) the `markers`/`PRD_INCLUDE_MARKERS` toggle + exact marker format, (c) the stale-include
        stderr warning behavior, citing PRD §2.3. Mirror resolveIncludes's @remarks/@param style.
  - (No .env.example / CONFIGURATION.md edits — S1 already added those rows/subsection.)

Task 5: FORMAT + VERIFY
  - RUN: npm run fix (lint:fix + prettier --write) → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-markers.test.ts (new suite green; 100% of new lines).
  - RUN: npx vitest run tests/unit/core/prd-includes.test.ts (S1 regression — must stay green).
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts (S2 regression — must stay green).
  - RUN: npx vitest run (full suite — no regression).
  - EXPECTED: all clean. If coverage <100%, one of the enumerated branches is unhit — add the
        matching case from Task 1 (esp. the directory-.md stale case #11 and getter spellings).
```

### Implementation Patterns & Key Details

```ts
// ---- src/config/constants.ts (APPEND) — first boolean getter ----
export function getPrdIncludeMarkers(): boolean {
  const raw = process.env[PRD_INCLUDE_MARKERS];
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

// ---- src/core/session-utils.ts (EDIT S2's landed code) ----

// (a) ResolveOpts — S1 reserved this field:
export interface ResolveOpts {
  maxDepth?: number;
  /** Wrap expanded includes with markers (PRD §2.3). Defaults to getPrdIncludeMarkers(). */
  markers?: boolean;
}

// (b) resolvePRD — compute flag once, thread it down:
export async function resolvePRD(prdPath: string, opts?: ResolveOpts): Promise<string> {
  const absEntry = resolve(prdPath);
  const baseDir = dirname(absEntry);
  const maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth();
  const markers = opts?.markers ?? getPrdIncludeMarkers(); // S3
  logger().debug({ prdPath: absEntry, baseDir, maxDepth, markers }, 'Resolving PRD includes');
  const entryContent = await readUTF8FileStrict(absEntry, 'read PRD');
  return expandIncludesRecursive(entryContent, baseDir, maxDepth, 0, new Set([absEntry]), markers);
}

// (c) worker — add `markers` param (LAST) + thread into self-call + replace substitution line:
async function expandIncludesRecursive(
  content: string,
  baseDir: string,
  maxDepth: number,
  depth: number,
  visited: Set<string>,
  markers: boolean, // S3
): Promise<string> {
  if (depth >= maxDepth) return content; // S2 depth gate (UNCHANGED)
  const matches = [...content.matchAll(RESOLVE_TOKEN)]; // S2's re-declared regex (UNCHANGED)
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    out += content.slice(last, idx);
    const token = m[1];
    const abs = resolve(baseDir, token);
    if (visited.has(abs)) { out += m[0]; last = idx + m[0].length; continue; } // S2 cycle (UNCHANGED)
    let replacement: string | undefined;
    try {
      const st = await stat(abs);
      if (st.isFile()) {
        const child = await readUTF8FileStrict(abs, 'read include');
        replacement = await expandIncludesRecursive(child, baseDir, maxDepth, depth + 1, new Set(visited).add(abs), markers); // S3: +markers
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') { replacement = undefined; } else { throw new SessionFileError(abs, 'stat include', e as Error); }
    }
    // ── S3: stale-include stderr warning (.md token that didn't resolve to a file) ──
    if (replacement === undefined && token.endsWith('.md')) {
      console.warn(`[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`);
    }
    // ── S3: optional include markers around expanded content ──
    out += markers && replacement !== undefined
      ? `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`
      : (replacement ?? m[0]);
    last = idx + m[0].length;
  }
  out += content.slice(last);
  return out;
}

// ---- tests/unit/core/prd-markers.test.ts (NEW — key assertions) ----
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePRD } from '../../../src/core/session-utils.js';
import { getPrdIncludeMarkers, PRD_INCLUDE_MARKERS } from '../../../src/config/constants.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'prd-markers-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('wraps expanded includes when PRD_INCLUDE_MARKERS is set', async () => {
  vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
  writeFileSync(join(tmp, 'a.md'), 'A');
  writeFileSync(join(tmp, 'main.md'), '@a.md');
  await expect(resolvePRD(join(tmp, 'main.md'))).resolves.toBe(
    '<!-- @include: a.md -->\nA\n<!-- @end-include -->'
  );
});

it('opts.markers=false suppresses markers even when env=1', async () => {
  vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
  writeFileSync(join(tmp, 'a.md'), 'A');
  writeFileSync(join(tmp, 'main.md'), '@a.md');
  await expect(resolvePRD(join(tmp, 'main.md'), { markers: false })).resolves.toBe('A');
});

it('emits a stderr warning for a stale .md token and keeps it verbatim', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(join(tmp, 'main.md'), '@missing.md');
  const out = await resolvePRD(join(tmp, 'main.md'));
  expect(out).toBe('@missing.md');                       // stays literal
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('missing.md'); // message names the token
});

it('does NOT warn for a cycle back-edge (file exists)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(join(tmp, 'a.md'), 'X @a.md Y');         // self-include
  await resolvePRD(join(tmp, 'a.md'));                   // entry IS a.md → inner @a.md is a cycle
  expect(warn).not.toHaveBeenCalled();
});

it('is idempotent with markers on (resolve(resolve(x)) === resolve(x))', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv(PRD_INCLUDE_MARKERS, '1');
  writeFileSync(join(tmp, 'b.md'), 'B');
  writeFileSync(join(tmp, 'a.md'), '[@b.md]');
  writeFileSync(join(tmp, 'main.md'), '@a.md');
  const r1 = await resolvePRD(join(tmp, 'main.md'), { markers: true });
  writeFileSync(join(tmp, 'round2.md'), r1);             // re-resolve r1 as a fresh entry
  const r2 = await resolvePRD(join(tmp, 'round2.md'), { markers: true });
  expect(r2).toBe(r1);                                    // byte-identical fixed point
});
```

### Integration Points

```yaml
DOWNSTREAM (S3 ENABLES these — do NOT do them here):
  - P1.M1.T2.S1/S2 (wiring): threads resolvePRD's (now marker/stale-aware) output through hashPRD,
        snapshot, createDeltaSession, findSessionByHash, handleDelta. S3 only PROVIDES the
        completed resolvePRD; it does not call it from those paths.

NO OTHER INTEGRATION in S3: no CLI, no pipeline, no agent. resolvePRD remains a pure
  (prdPath, opts?) → resolved-string function. resolveIncludes (S1) stays exported + marker-less +
  unchanged. The recursion/cycle/depth engine (S2) is preserved — S3 only ADDS the markers param,
  the stale-warning, and the marker-wrap at the substitution site.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first; template-literal/ternary may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean (watch unused-vars on the new `markers` param)
npm run format:check         # prettier --check — clean
# Expected: all clean. If no-unused-vars flags `markers`, confirm it's read at the substitution site
# (it is). If typecheck fails on the interface edit, confirm you ADDED (not replaced) the field.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new suite (must pass + cover 100% of the new lines in session-utils.ts + constants.ts):
npx vitest run tests/unit/core/prd-markers.test.ts
# S1 regression — single-level suite must stay green (S3 must not touch resolveIncludes):
npx vitest run tests/unit/core/prd-includes.test.ts
# S2 regression — recursive suite must stay green (S3 edits S2's worker but preserves behavior):
npx vitest run tests/unit/core/prd-resolve.test.ts
# Coverage check on the touched source files:
npx vitest run tests/unit/core/prd-markers.test.ts tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts --coverage
# Expected: prd-markers green; prd-includes green; prd-resolve green; new/edited lines at 100%.
# If a branch is uncovered, add the matching real-tmpdir case from Task 1 (cases 1–17).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S3 — resolvePRD is a pure function; not yet wired into the pipeline (P1.M1.T2). Smoke-test
# markers + stale warning directly against a real multi-file PRD layout:
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { resolvePRD } from './src/core/session-utils.ts';
const d = mkdtempSync(join(tmpdir(), 'inc-'));
writeFileSync(join(d, 'a.md'), 'A');
writeFileSync(join(d, 'main.md'), '@a.md\n@missing.md');
process.env.PRD_INCLUDE_MARKERS='1';
resolvePRD(join(d, 'main.md')).then(r => { console.log(JSON.stringify(r)); rmSync(d, { recursive: true, force: true }); });
"
# Expected stdout: a string containing '<!-- @include: a.md -->\nA\n<!-- @end-include -->' followed by
# the literal '@missing.md'. Expected stderr: a single '[prd-resolver] stale include @missing.md ...' line.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - resolve(resolve(x)) === resolve(x) for within-depth fixtures, markers OFF and ON.
#   - Markers wrap every depth of expansion; literal survivors (missing/dir/cycle/depth) never wrapped.
#   - opts.markers overrides env both ways (true→on when env unset; false→off when env=1).
#   - Stale warning fires only for .md tokens that don't resolve to a file (ENOENT/dir); NOT for
#     non-.md, cycles, depth-exceeded, or resolved tokens. Goes to STDERR (console.warn, not logger).
#   - getPrdIncludeMarkers rejects empty/0/false/no/off (case-insensitive, trimmed); else true.
#   - resolveIncludes (S1) UNCHANGED — prd-includes.test.ts still green (marker-less single-level).
#   - resolvePRD recursion/cycle/depth (S2) PRESERVED — prd-resolve.test.ts still green.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean (no unused-vars on the new `markers` param; no-floating-promises).
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-markers.test.ts` green.
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts` green (S1 regression).
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts` green (S2 regression).
- [ ] `npx vitest run` (full suite) green — no regression.
- [ ] Touched lines in `src/core/session-utils.ts` and `src/config/constants.ts` at 100% coverage.

### Feature Validation
- [ ] `ResolveOpts.markers?: boolean` present (S1's reserved field).
- [ ] `getPrdIncludeMarkers()` truthy except unset/empty/0/false/no/off (case-insensitive, trimmed).
- [ ] `PRD_INCLUDE_MARKERS=1` / `opts.markers=true` wraps each expanded include at every depth.
- [ ] `opts.markers=false` overrides env `=1`; default (unset) → no markers.
- [ ] Stale `.md` token → ONE stderr `console.warn` per pass + verbatim in output.
- [ ] Non-`.md` missing token, cycle back-edge, depth-exceeded, resolved token → NO warning.
- [ ] `resolve(resolve(x)) === resolve(x)` byte-for-byte for within-depth fixtures (markers off AND on).
- [ ] Line-start and inline/parenthesized expansions both wrap correctly.

### Code Quality Validation
- [ ] EDITS S2's landed `resolvePRD`/`expandIncludesRecursive` (does NOT recreate them); preserves
      S2's cycle branch, depth gate, path-based visited set, and base invariant.
- [ ] Does NOT add marker/stale-warning logic to S1's single-level `resolveIncludes`.
- [ ] Adds `getPrdIncludeMarkers` to the EXISTING constants import line (one key, no second import).
- [ ] Uses `console.warn` (stderr) for the stale warning — NOT the stdout-bound pino logger.
- [ ] Marker format exactly `<!-- @include: ${token} -->\n${body}\n<!-- @end-include -->` (PRD §2.3).
- [ ] Real-tmpdir test file `prd-markers.test.ts` (NOT vi.mock fs); distinct from S1's + S2's files.

### Documentation & Deployment
- [ ] JSDoc on `resolvePRD` documents idempotency, the `markers`/`PRD_INCLUDE_MARKERS` toggle, the
      exact marker format, and the stale-include stderr warning; cites PRD §2.3.
- [ ] Commit message notes: markers + stale-warning + idempotency layered on S2; stderr via
      console.warn (logger is stdout-bound); getter is first boolean env parser; wiring = P1.M1.T2.

---

## Anti-Patterns to Avoid

- ❌ Don't route the stale-include warning through `logger().warn` — the pino logger writes to
      **stdout** (verified). PRD §2.3 requires **stderr**; use `console.warn` (precedent in
      `verify-groundswell-version.ts`).
- ❌ Don't recreate `resolvePRD` or the recursive worker — S2 landed them. EDIT them: add the
      `markers` param, thread it into the self-call, and replace the single substitution line.
- ❌ Don't add marker/stale-warning logic to S1's `resolveIncludes` — it's single-level and stays
      marker-less; its test suite must remain green unchanged.
- ❌ Don't wrap literal survivors (missing/dir/cycle/depth) with markers — only successfully-expanded
      content is wrapped (`markers && replacement !== undefined`).
- ❌ Don't fire the stale warning for cycles, depth-exceeded, or non-`.md` tokens — guard is
      `replacement === undefined && token.endsWith('.md')`, placed AFTER the try/catch so cycles
      (which `continue` earlier) and depth-exceeded (gate returns earlier) never reach it.
- ❌ Don't write an idempotency test that relies on depth-truncation (`maxDepth` small) — depth-
      exceeded is intentionally NOT a fixed point (you can't un-truncate). Use within-depth fixtures.
- ❌ Don't redeclare `PRD_INCLUDE_MARKERS` — S1 already exports it (constants.ts ~line 353). Just add
      the `getPrdIncludeMarkers()` getter that reads it.
- ❌ Don't add a second `import … from '../config/constants.js'` line — extend S1's existing import
      with the new `getPrdIncludeMarkers` key.
- ❌ Don't use the absolute path in the marker — `${token}` is the ORIGINAL matched relative path
      (e.g. `docs/a.md`), per PRD §2.3's `<!-- @include: path -->`.
- ❌ Don't add S3's tests to `prd-includes.test.ts` (S1) or `prd-resolve.test.ts` (S2) — create the
      distinctly-named `prd-markers.test.ts` to stay merge-safe with both parallel subtasks.
- ❌ Don't skip the directory-`.md` stale case (mkdirSync a dir named `x.md`) or the getter
      spellings — vitest enforces 100%; the `isFile()===false && token.endsWith('.md')` branch and
      every `getPrdIncludeMarkers` spelling must be hit.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: S3 layers three small, well-specified behaviors onto S2's LANDED worker at a single,
clearly-identified substitution site. The two non-obvious decisions are fully resolved with
in-repo evidence: (a) the stale warning MUST use `console.warn` because the pino logger writes to
stdout (proven in `logger.ts` `buildRoot`), and (b) idempotency holds for within-depth fixtures
while depth-exceeded is an intentional, documented non-fixed-point. The marker format is proven
self-protecting against re-expansion (`@include`/`@end-include` capture non-`.md`, non-existent
paths). The test strategy is concrete (17 real-tmpdir cases mapping 1:1 to every new coverage
branch, including the getter spellings and the directory-`.md` stale case). Scope boundaries with
S1 (`resolveIncludes` untouched), S2 (recursion/cycle/depth preserved), and P1.M1.T2 (wiring
deferred) are explicit. Residual risks: (a) a prettier nit on the ternary/template-literal
(auto-fixed via `npm run fix`), (b) the exact marker string assertion needing a tweak if the
fixture content's trailing newline differs (the format is pinned so this is deterministic), and
(c) coverage of the directory-`.md` branch possibly needing an explicit `mkdirSync('x.md')` case
(recipe provided). No external/runtime unknowns.