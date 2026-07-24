# Research — P1.M1.T1.S2 (recursive expansion engine with cycle detection + max depth)

S2 builds the recursive entry point `resolvePRD(prdPath, opts?)` on top of S1's single-level
`resolveIncludes`. S1 is already landed in `src/core/session-utils.ts` (verified) and
`src/config/constants.ts` (verified). This note records the design decisions + the exact S1
surface S2 consumes.

## 1. Exact S1 surface S2 consumes (verified in-repo, not assumed)

`src/core/session-utils.ts` (already present):
```ts
const INCLUDE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g;   // MODULE-PRIVATE — not exported

export interface ResolveOpts {
  maxDepth?: number;   // (S3 will add markers?: boolean — S2 must NOT add it)
}

export async function resolveIncludes(
  content: string, baseDir: string, opts?: ResolveOpts
): Promise<string>   // SINGLE-LEVEL: substitutes each @token with the file's verbatim contents;
                     // does NOT re-scan substituted content. maxDepth used only as a <1 gate.
```
Reusable helpers already in the file (NO new imports needed for S2 — verified):
- `readUTF8FileStrict(path, operation): Promise<string>` — strict-UTF-8 read, throws `SessionFileError`.
- `SessionFileError(path, operation, cause?)` — `code` = errno code.
- `stat` — already imported (`node:fs/promises`, line 33).
- `resolve, join, dirname, basename` — already imported (`node:path`, line 34). **`dirname` is available for S2's baseDir computation.**
- `logger()` — lazy `getLogger('session-utils')`.

`src/config/constants.ts` (already present):
- `PRD_INCLUDE_MAX_DEPTH` (env-var name), `DEFAULT_PRD_INCLUDE_MAX_DEPTH = 10`,
  `getPrdIncludeMaxDepth(): number` (NaN/<=0 → 10), `PRD_INCLUDE_MARKERS` (name only; S3 consumes).

## 2. THE design decision — true recursion, NOT fixpoint iteration

Two architectures were considered for making expansion recursive:

**Option A — fixpoint iteration of `resolveIncludes`** (call it repeatedly until output stops
changing, bounded by maxDepth):
- ✅ Genuinely "wraps" S1's `resolveIncludes`; zero scan-logic duplication.
- ❌ **Cannot implement the contract's explicit "visited Set<string> for cycle detection".**
  `resolveIncludes` is a single-level black box operating on a content blob; S2 cannot observe
  WHICH files it read, so it cannot build a visited set. Mutual cycles (a→b→a) oscillate and
  only terminate by hitting maxDepth (not graceful cycle detection).
- ❌ Re-scans the whole document every iteration (O(depth × size)).

**Option B — true recursion with a path-based visited Set + depth counter (CHOSEN):**
- ✅ Satisfies BOTH contract requirements: "Maintain a visited Set<string> for cycle detection"
  AND "Track depth and abort if exceeding PRD_INCLUDE_MAX_DEPTH".
- ✅ Single pass per branch; graceful cycle handling (cycle → leave back-edge literal, terminate).
- ⚠️ Must re-declare `INCLUDE_TOKEN` (S1 made it module-private; S2 cannot import it). The
  regex is ONE line and is a fixed contract — minimal, acceptable duplication. All other logic
  (stat / readUTF8FileStrict / ENOENT / SessionFileError / resolve / logger) is REUSED, not copied.

**Decision: Option B.** S2 adds `resolvePRD` + a module-private recursive worker. `resolvePRD`
does NOT call `resolveIncludes` (the visited-set cycle check requires control over per-file
reads that a single-level black box cannot offer). `resolveIncludes` remains S1's exported
single-level primitive (S1's `prd-includes.test.ts` stays green, unchanged).

> Note on S1's integration-section wording: S1's PRP predicted S2 would "wrap resolveIncludes in
> a depth-decrementing recursive loop". That was S1's guess. S2's BINDING contract explicitly
> requires a visited Set for cycle detection, which forces Option B. This is the authoritative
> reconciliation — no conflict with S1 (S2 only ADDS resolvePRD + worker; it does not modify S1's
> resolveIncludes or ResolveOpts).

## 3. Cycle detection MUST be path-based (diamond-safe), not a flat global set

A flat "all files ever included" set would WRONGLY deduplicate diamonds: if both `a.md` and
`b.md` include `shared.md` (a diamond, NOT a cycle), a flat set skips `shared.md` the second
time. PRD §2.3 says includes are "replaced inline" (like C `#include`) → a shared doc referenced
in two places MUST appear in both.

**Correct approach: pass the visited set BY VALUE down each branch (copy-on-recurse).** Each
branch carries its own ANCESTRY chain. A cycle is a file reappearing in its own ancestry
(a→b→a); a diamond (a→c, b→c) never puts c in its own ancestry → expands in both. Verified:

| Graph | flat set | path-based set | desired |
| --- | --- | --- | --- |
| a→a (self) | stops | stops | stop (cycle) |
| a→b→a (mutual) | stops | stops | stop (cycle) |
| entry→a→c, entry→b→c (diamond) | c expanded ONCE ❌ | c expanded TWICE ✅ | twice (inline) |

Implementation: `const childVisited = new Set(visited).add(absPath);` — immutable ancestry per
branch. The entry PRD itself seeds the initial set (so an include that points back at the entry
is correctly treated as a cycle).

## 4. Depth semantics (consistent with S1's gate + PRD §2.3)

- Entry content scanned at `depth = 0`.
- A token resolving to a file is read, then its content is expanded recursively at `depth + 1`.
- Base case: `if (depth >= maxDepth) return content;` — at the depth limit, content is returned
  with remaining `@token`s left literal (no further expansion). Bounded nesting = `maxDepth`
  levels (default 10) — matches "up to PRD_INCLUDE_MAX_DEPTH (default 10)".
- `maxDepth = opts?.maxDepth ?? getPrdIncludeMaxDepth()` (S2 honors the opts override the way
  S1's gate does).

## 5. Project-root-relative base invariant (PRD §2.3 — load-bearing)

`baseDir = dirname(resolve(prdPath))` is computed ONCE from the entry PRD and passed UNCHANGED
into every recursive call. It is NEVER re-derived from an included file's location. This is the
PRD §2.3 invariant ("relative to the entry PRD's directory, regardless of which file contains
the directive"). Consequence: a `@shared.md` appearing inside `sub/a.md` resolves to
`<entryDir>/shared.md`, NOT `<entryDir>/sub/shared.md`. A dedicated test PROVES this (see PRP
task 3, case 9).

## 6. Error handling (mirrors S1's resolveIncludes exactly)

| Situation | Behavior |
| --- | --- |
| Entry file missing / invalid UTF-8 | `readUTF8FileStrict` → `SessionFileError` (resolvePRD reads entry itself) |
| Included file missing (ENOENT), at any depth | silent verbatim (leave `@token`); S3 adds the `.md` stderr warning |
| Token resolves to a directory (isFile false) | silent verbatim |
| `stat` non-ENOENT error (e.g. EACCES) | `SessionFileError` |
| Included file invalid UTF-8 (read fails), at any depth | `SessionFileError` (via readUTF8FileStrict) |
| Cycle (file in current ancestry) | silent verbatim (leave `@token`); bounded regardless |

## 7. Scope discipline — what S2 does NOT do (sibling subtasks own these)

- **S1** (landed): single-level tokenizer, ResolveOpts{maxDepth}, config constants, single-level
  tests. S2 must NOT modify resolveIncludes / ResolveOpts / constants.
- **S3** (`P1.M1.T1.S3`): `<!-- @include -->` markers (gated on `PRD_INCLUDE_MARKERS`), stale-
  include `.md` stderr warnings, idempotency re-resolution assertion. S2's worker is structured
  with a single clear substitution site so S3 can wrap it with markers later, but S2 emits NO
  markers and adds NO `markers` field to ResolveOpts (collision-free with S3; an unused field is
  unnecessary and S3 owns it).
- **P1.M1.T2.S1/S2** (wiring): threads resolved content through hashPRD / snapshot /
  createDeltaSession / findSessionByHash / handleDelta. S2 only PROVIDES resolvePRD; it does not
  call it from those paths.

## 8. Test strategy — NEW real-tmpdir file, NO collision with S1

S1 owns `tests/unit/core/prd-includes.test.ts`. S2 creates a SEPARATE file
`tests/unit/core/prd-resolve.test.ts` (real tmpdir via `mkdtempSync`/`writeFileSync`/`rmSync`,
mirroring S1's + `tasks-json-recovery.test.ts` style — NOT the `vi.mock('node:fs/promises')`
style of `session-utils.test.ts`, which would make cycle/existence logic meaningless). Real
files are mandatory for trustworthy recursion/cycle/base-invariant assertions.

Coverage (vitest enforces 100% on `src/**/*.ts`): every branch of resolvePRD + the recursive
worker must be hit. The 13 test cases in the PRP map 1:1 onto the branches (depth-gate TRUE/
FALSE, visited-has TRUE/FALSE, isFile TRUE/FALSE, ENOENT, stat-error, read-error, entry-read-
error, cycle self, cycle mutual, diamond, base-invariant, maxDepth-override).

## 9. Validation commands (verified executable in this repo)

- `npm run typecheck` → `tsc --noEmit -p tsconfig.build.json`
- `npm run lint` → `eslint . --ext .ts` (prettier is ERROR-enforced; run `npm run fix` first)
- `npm run format:check` → `prettier --check`
- `npm run validate` → lint && format:check && typecheck
- `npx vitest run tests/unit/core/prd-resolve.test.ts` (new suite)
- `npx vitest run tests/unit/core/prd-includes.test.ts` (S1 regression — must stay green)
- `npx vitest run` (full suite regression)