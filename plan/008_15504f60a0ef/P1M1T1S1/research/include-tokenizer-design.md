# Research — P1.M1.T1.S1 (include directive tokenizer)

TDD foundation for PRD §2.3 (Distributed/Multi-File PRDs). S1 = tokenizer + boundary
+ existence + single-level expansion + config constants + docs. Recursion/cycle/maxDepth-
loop = S2; markers/idempotency/stale-include warnings = S3.

## 1. Where it lives & what to mirror

- **`src/core/session-utils.ts`** — append `resolveIncludes` + `ResolveOpts` "alongside
  `hashPRD`" (contract). Reuse these EXISTING helpers (do not reinvent):
  - `readUTF8FileStrict(path, operation): Promise<string>` (session-utils.ts:201) — wraps
    `readFile` with `new TextDecoder('utf-8', { fatal: true })` and throws `SessionFileError`.
    USE THIS for reading an included file (consistent error handling + strict UTF-8).
  - `SessionFileError` (session-utils.ts:56) — `new SessionFileError(path, operation, cause)`.
  - Lazy logger pattern: `const logger = (): Logger => (_logger ??= getLogger('session-utils'))`
    (session-utils.ts:38-39) — reuse, do not create a new logger channel.
  - Imports already present at top of file: `readFile, writeFile, mkdir, rename, unlink` from
    `node:fs/promises`; `resolve, join, dirname, basename` from `node:path`. ADD `stat` to the
    `node:fs/promises` import (do not add a second import line).

- **`src/config/constants.ts`** — append a new env-var-name + default + getter TRIPLE that
  MIRRORS the existing `RESEARCH_TIMEOUT` block exactly (constants.ts lines ~198-230):
  ```ts
  export const RESEARCH_TIMEOUT = 'RESEARCH_TIMEOUT';
  export const DEFAULT_RESEARCH_TIMEOUT_SECONDS = 300;
  export function getResearchTimeoutSeconds(): number {
    const raw = Number(process.env[RESEARCH_TIMEOUT] ?? DEFAULT_RESEARCH_TIMEOUT_SECONDS);
    if (Number.isNaN(raw) || raw <= 0) return DEFAULT_RESEARCH_TIMEOUT_SECONDS;
    return raw;
  }
  ```
  Pattern to copy for S1: `PRD_INCLUDE_MAX_DEPTH` (name) + `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`
  + `getPrdIncludeMaxDepth(): number` (validate: NaN/<=0 → default). Plus `PRD_INCLUDE_MARKERS`
  (env-var NAME only; consumed in S3 — declare the export now, do NOT wire behavior).

## 2. The tokenizer rule (PRD §2.3, disambiguated)

A `@token` is a candidate include iff BOTH hold:
- **BOUNDARY** — the `@` is at content start OR the character immediately before it is NOT a
  path char. Path-char set = `[A-Za-z0-9_./-]` (word chars + `.` + `/` + `-`).
- **EXISTENCE** — `resolve(baseDir, token)` is an existing **file** (stat ok AND `isFile()`).
  A missing path OR a directory → NOT an include → stays verbatim, SILENT (no warning in S1;
  S3 adds the `.md`-token stderr warning).

Worked examples (all verified by inspection against the rule):
| Input (baseDir has `docs/a.md`) | Boundary? | Exists? | Result |
| --- | --- | --- | --- |
| `@docs/a.md` (alone on line) | yes (line start) | yes | expanded |
| `see @docs/a.md here` | yes (space before @) | yes | expanded inline |
| `(@docs/a.md)` | yes ( `(` before @) | yes | expanded; `(` `)` stay |
| `foo@bar.com` | NO (`o` before @ is path char) | — | literal (untouched) |
| `@nonexistent.md` | yes | NO (ENOENT) | literal, silent |
| `@docs` where `docs` is a directory | yes | NO (isFile false) | literal, silent |
| `dir/@file.md` | NO (`/` before @ is path char) | — | literal |

Single regex that captures boundary + body (Node 20+ supports lookbehind; target is esnext):
```ts
const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;
// group 1 = the path token (without @). \w = [A-Za-z0-9_], plus literal . / - in both classes.
```
Lookbehind `(?<![\w./-])` enforces "preceding char is not a path char" (vacuously true at
content start). If lookbehind is undesired, the equivalent manual check is
`idx === 0 || !/[\w./-]/.test(content[idx - 1])`. Either is acceptable; the SPEC is the
boundary definition above.

## 3. S1 algorithm (single-level — NO recursion; recursion is S2)

```
resolveIncludes(content, baseDir, opts?):
  maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth()      // uses the new config getter
  if maxDepth < 1: return content                            // depth gate (base case S2 builds on)
  matches = [...content.matchAll(INCLUDE_TOKEN)]            // collect first; async reads next
  out = ''; last = 0
  for m of matches:
    out += content.slice(last, m.index)                      // gap before token (verbatim)
    token = m[1]; abs = resolve(baseDir, token)
    expanded = undefined
    try:
      st = await stat(abs)
      if st.isFile():
        expanded = await readUTF8FileStrict(abs, 'read include')   // reuse existing helper
      // else: directory → not a file → leave expanded=undefined (silent)
    catch e:
      if e.code === 'ENOENT': /* missing → silent */ expanded = undefined
      else: throw new SessionFileError(abs, 'stat include', e)    // genuine error
    out += expanded ?? m[0]                                   // substitute or keep verbatim
    last = m.index + m[0].length
  out += content.slice(last)                                  // tail
  return out
```
Key: `m[0]` is the full `@token`; falling back to `m[0]` preserves the EXACT original bytes
(idempotency-friendly). One level only — included content's own `@tokens` are NOT re-scanned
in S1 (S2 adds the recursive loop with cycle detection + depth decrement).

## 4. Scope discipline (do NOT implement these — sibling subtasks own them)

- **S2** (`P1.M1.T1.S2`): recursive expansion, cycle detection, depth decrement loop. S1's
  `maxDepth` gate is the base case S2 recurses against; S1 does NOT loop.
- **S3** (`P1.M1.T1.S3`): `<!-- @include -->` markers (gated on `PRD_INCLUDE_MARKERS`), stale-
  include `.md` stderr warnings, idempotency re-resolution assertion. S1 adds the
  `PRD_INCLUDE_MARKERS` constant NAME but does not consume it.

To keep `opts` used (and lint-clean under `@typescript-eslint/no-unused-vars`, which has no
blanket param ignore — only `^_`), S1's `ResolveOpts` declares ONLY `{ maxDepth?: number }`
(the field S1 honors for the gate). S3 will EXTEND the interface to add `markers?: boolean`.
Do NOT add a `markers` field in S1 (it would be unread/unused).

## 5. Test strategy — REAL tmpdir, not vi.mock fs

`tests/unit/core/session-utils.test.ts` mocks `node:fs/promises` (good for the pure wrappers,
painful for existence/boundary logic). For `resolveIncludes`, create a DEDICATED real-fs test
file `tests/unit/core/prd-includes.test.ts` using `mkdtempSync`/`writeFileSync`. Real files make
boundary/existence assertions trustworthy. Coverage of every branch (vitest enforces 100% on
`src/**/*.ts`) via real fs:
- expand happy path: real `docs/a.md` → token expands to its content.
- inline + parenthesized + line-start boundary variants.
- `foo@bar.com` non-boundary → literal.
- ENOENT (missing token) → silent literal.
- directory token (`docs/` is a dir) → silent literal (isFile false).
- read-error branch: write a file with INVALID utf-8 bytes → `readUTF8FileStrict` fatal decode
  throws → assert `SessionFileError`. (Clean real-fs way to cover the read catch.)
- stat-non-ENOENT branch: `chmod 000` a file (Linux) to force EACCES → assert `SessionFileError`.
  (Guard with `process.platform !== 'win32'` skip; if flaky, a single focused
  `vi.mock('node:fs/promises', ...)` for just `stat` is acceptable for THIS one branch.)
- maxDepth gate: `opts.maxDepth = 0` → content returned unchanged (no stat calls).
- `getPrdIncludeMaxDepth()` getter: unset → 10; garbage → 10; valid → parsed (stub env).

## 6. Docs (Mode A — rides with the code)

- **`.env.example`**: add two rows near the existing `# MODEL CONFIGURATION`/resilience block:
  `# PRD_INCLUDE_MAX_DEPTH=10` and `# PRD_INCLUDE_MARKERS=` (commented, optional).
- **`docs/CONFIGURATION.md`**: add a `### Distributed PRDs` subsection (mirror the heading style
  of `### Resilience Tuning` at line 145). Document `@path/to/file.md` directive, boundary +
  existence rules, `PRD_INCLUDE_MAX_DEPTH` (default 10), `PRD_INCLUDE_MARKERS` (optional,
  S3-emitted markers). Cite PRD §2.3.
- **JSDoc** on `resolveIncludes` + `ResolveOpts` (mirror `hashPRD`'s JSDoc style — `@remarks`,
  `@param`, `@returns`, `@example`).

## 7. Validation

- `npm run typecheck` (`tsc --noEmit -p tsconfig.build.json`) — clean.
- `npm run lint && npm run format:check` — clean (prettier is ERROR-enforced; run `npm run fix`).
- `npx vitest run tests/unit/core/prd-includes.test.ts` — all pass, and the new
  `resolveIncludes` lines in `session-utils.ts` hit 100% (global threshold; the existing
  session-utils.test.ts still covers the rest of the file).
- Regression: `npx vitest run tests/unit/core/session-utils.test.ts` still green (S1 only ADDS
  exports; it must not alter hashPRD/readUTF8FileStrict/etc.).