# System Context — §2.3 Distributed-PRD Include-Dedup Idempotency Bugfixes

## Scope
This changeset fixes **two MINOR bugs** in the distributed-PRD `@token` include resolver, both
located in `src/core/session-utils.ts`, both violations of spec **§2.3** (`spec/02-core-concepts.md`,
lines 24–30). No new features; no new dependencies; behavior change is confined to two pathological
edge cases that do not affect realistic distributed PRDs.

## The feature under fix
`resolvePRD(prdPath, opts?)` (export, `src/core/session-utils.ts:611`) resolves a PRD entry file,
recursively expanding `@path/to/file.md` include directives with **global-flat-dedup + elision** so
the result is an **idempotent fixed point** (`resolve(resolve(x)) === resolve(x)`). It delegates to
the internal worker `expandIncludesRecursive(content, baseDir, maxDepth, depth, visited, markers)`
(def `src/core/session-utils.ts:471`).

Key internals (all confirmed by reading the source):
- **`RESOLVE_TOKEN`** (`src/core/session-utils.ts:422`):
  `/(?<![\w./-])@([A-Za-z0-9_./-]+)/g` — the one-line include-token contract. Group 1 = bare path
  (no leading `@`). Matches `@` only when NOT preceded by a path-class char `[\w./-]`, and captures
  the longest run of path chars `[A-Za-z0-9_./-]` (note: `-`, `.`, `/`, `_` are path chars; `:` is NOT).
- **Global-flat-dedup**: `visited` is a single `Set<string>` of resolved absolute paths, shared by
  reference across the whole resolution (never copied per branch). First encounter expands; every
  later reference is **elided** (markers off → token dropped; markers on → reference comment).
  The entry file is pre-seeded in `visited` (`resolvePRD`, `:628`). This bounds cycles/diamonds.
- **Elision branch** (`:492-501`): `visited.has(abs)` → `out += markers ? '<!-- @include-ref: ${token} -->' : ''`.
- **Expansion / marker emission** (`:543-547`): on first encounter + resolvable file, the child is
  recursed; with markers on the expansion is wrapped
  `<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->`.
- **Depth gate** (`:479`): `if (depth >= maxDepth) { return content; }` — returns body UNSCANNED.
- **Stale-warning** (`:536-541`): a `.md` token that fails to resolve (ENOENT/dir) emits one
  `console.warn` (→ stderr; pino writes stdout, §2.3 requires stderr). Elided/resolved/depth-exceeded
  tokens never warn.
- **Config**: `getPrdIncludeMaxDepth()` (`src/config/constants.ts:1272`, default 10, `≤0`/`NaN` → 10)
  and `getPrdIncludeMarkers()` (`src/config/constants.ts:1321`, truthy unless unset/empty/`0`/`false`/
  `no`/`off`). Env surfaces `PRD_INCLUDE_MAX_DEPTH` / `PRD_INCLUDE_MARKERS` (hack-config.ts:403/410).

## Authoritative spec (§2.3, `spec/02-core-concepts.md`)
- **L24 Expansion rules**: boundary (start-of-line or preceded by non-path char) + existence
  (resolves to a file). Project-root-relative. `PRD_INCLUDE_MAX_DEPTH` (default 10) is
  "defense-in-depth"; "dedup itself bounds recursion, so cycles and diamond dependencies terminate
  without relying on it."
- **L26 No duplication (dedup)**: single global flat visited set keyed on absolute path; first
  encounter wins in document order; later references are **elided** ("the `@token` is dropped");
  with `PRD_INCLUDE_MARKERS` on, replaced by "a stable reference comment that names the path but
  contains **no resolvable `@token` of its own**. Elision — not verbatim — is mandatory."
- **L27 Idempotency**: "Re-resolving already-resolved content MUST yield identical bytes
  (`resolve(resolve(x)) === resolve(x)`). … every resolvable token has been expanded once or elided,
  so a second pass has nothing new to expand." Unconditional MUST.
- **L30 Markers**: "When `PRD_INCLUDE_MARKERS` is set, resolved output emits
  `<!-- @include: path -->` / `<!-- @end-include -->` comment markers. A `.md` token that fails to
  resolve (stale include) MUST emit a stderr warning."

> Note: L30 specifies the marker *strings* `<!-- @include: path -->` / `<!-- @end-include -->`, while
> L26 requires markers to contain "no resolvable @token of its own" and L27 demands unconditional
> idempotency. BUG-001 is precisely the tension where L30's literal strings DO contain a resolvable
> `@token`. The fix reconciles them by making the emitted markers structurally non-resolvable.

## What is NOT changing
- Core global-flat-dedup, cycle/diamond/self-cycle/entry-back-edge elision, document-order
  first-encounter, base invariant (project-root-relative), stale-`.md` stderr warning, and
  within-depth idempotency are all CORRECT and remain untouched (validated by 43 passing tests +
  ~20 adversarial probes per the bug report).
- The project's own real distributed PRD (`spec/SPEC.md` → 16 includes, 157 KB) resolves to zero
  surviving `@spec/` tokens and is byte-idempotent — unaffected by these fixes.

## Files in scope
- `src/core/session-utils.ts` — `expandIncludesRecursive` (marker emission `:498`,`:545`; depth gate
  `:479`) + its JSDoc (`:429-469`) + `resolvePRD` JSDoc bullets (`:574-595`).
- `tests/unit/core/prd-markers.test.ts` — asserts EXACT marker byte format (lines 61, 70, 88-92,
  113-115, 221-239 incl. N2's incorrect "resolve to ENOENT → silent verbatim" claim at :239).
- `tests/unit/core/prd-resolve.test.ts` — depth tests (lines 190, 208, 220) assert the CURRENT
  literal-survivor behavior; N4 idempotency test (`:368`) uses within-depth fixtures only.
- `src/config/constants.ts` — read-only reference (getPrdIncludeMaxDepth/Markers); no change expected.
- README.md / docs/*.md — changeset-level doc sweep (Mode B final task).
- `spec/02-core-concepts.md` §2.3 — HUMAN-OWNED spec; do NOT auto-mutate. If a line becomes
  inaccurate post-fix, record a recommendation for the human spec-owner only.

## Downstream-handoff notes
- Marker comments are NOT parsed/consumed anywhere in `src/` (verified: grep for `end-include` /
  `include-ref` / `@include` outside `session-utils.ts` returns only unrelated session/commit markers
  and agent-guidance prose in `src/agents/prompts.ts:35`). ⇒ Changing the marker byte format is SAFE;
  only tests assert it.
- The depth-gate elision (BUG-002 fix) emits the SAME reference comment format the marker collision
  fix (BUG-001) establishes ⇒ BUG-002 subtask depends on BUG-001 subtask.