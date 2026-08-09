# Bug Analysis & Fix Contracts — BUG-001 & BUG-002 (§2.3 Include Resolver)

> Root-cause analysis with exact line numbers, regex traces, reproduction, recommended fixes, and
> rejected alternatives. Grounds the `context_scope` of each subtask in `tasks.json`.

---

## BUG-001 — Marker comments contain a resolvable `@token` of their own
**Severity**: Minor · **ID**: BUG-001 · **Spec violated**: §2.3 L26 ("no resolvable `@token` of its
own") + L27 (unconditional idempotency MUST).

### Location
`src/core/session-utils.ts`, function `expandIncludesRecursive` (def `:471`):
- **`:498`** — elision reference marker: ``out += `<!-- @include-ref: ${token} -->`;``
- **`:545`** — expansion wrap: ``<!-- @include: ${token} -->\n${replacement}\n<!-- @end-include -->``

### Root cause (regex trace against `RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g`)
For the start marker `<!-- @include: a.md -->`:
- The `@` is preceded by a **space** (`<!-- @include`). Space ∉ `[\w./-]`, so the negative lookbehind
  `(?<![\w./-])` **PASSES** (it asserts the preceding char is NOT path-class — a space isn't).
- After `@`: `include: a.md`. The token class `[A-Za-z0-9_./-]+` matches `include` and **stops at `:`**
  (`:` is NOT a path char). Captured group 1 = **`include`**.
- ⇒ `@include` is captured as token `include`. `resolve(baseDir, 'include')` → if a FILE named exactly
  `include` (no extension) exists in the entry PRD's directory, `stat` → `isFile()` → it is READ and
  EXPANDED. Same for `@end-include` → token `end-include` (`-` is a path char) and `@include-ref` →
  token `include-ref`.

### Why it is only *environmentally* inert today
In normal operation no file named `include`/`end-include`/`include-ref` exists, so those tokens
`stat` to ENOENT and stay verbatim → idempotency accidentally holds. But they are `@token`s "of the
marker's own" — exactly what L26 forbids. The bug report's probe confirms: with a file named
`include` present, re-resolving markers-on output diverges
(`o2 === '<!-- <!-- @include: include -->\nCOLLISION-CONTENT\n<!-- @end-include -->: a.md -->\nA\n<!-- @end-include -->'`).

### Reproduction (from the bug report)
1. `tmp/a.md`='A'; `tmp/include`='COLLISION-CONTENT' (a FILE, no extension); `tmp/main.md`='@a.md'.
2. `o1 = resolvePRD('tmp/main.md', {markers:true})` → `'<!-- @include: a.md -->\nA\n<!-- @end-include -->'`
3. write `tmp/r2.md`=o1; `o2 = resolvePRD('tmp/r2.md', {markers:true})`
4. `o2 !== o1` — the marker's `@include` expanded into COLLISION-CONTENT. Fixed point violated.

### Recommended fix
Make the three marker strings **structurally non-resolvable** against `RESOLVE_TOKEN`. Pick ONE
provably-correct technique and apply consistently to all three:
- **(A) Defeat the lookbehind** — make the char immediately BEFORE `@` a path-class char `[\w./-]`
  (letter/digit/`_`/`.`/`/`/`-`). Then `(?<![\w./-])` FAILS → no match starts at that `@`.
- **(B) Defeat the token group** — make the char immediately AFTER `@` NOT in `[A-Za-z0-9_./-]`. Then
  `[A-Za-z0-9_./-]+` cannot start → no match.

Keep markers human-readable. **Prove** non-resolvability by tracing `RESOLVE_TOKEN` against each new
marker string (zero captures) and document the trace in a code comment. Markers are NOT parsed
anywhere in `src/` (verified — see `system_context.md`), so changing the byte format is safe; only
tests assert it.

### Tests affected (Mode A — update WITH the fix)
`tests/unit/core/prd-markers.test.ts` pins the EXACT old format and must be updated to the new
collision-proof format: lines **61, 70, 88-92, 113-115, 235-236**, and the **N2 test comment at :239**
which currently (incorrectly) claims markers "resolve to ENOENT non-.md tokens → silent verbatim".
Add a NEW regression test: markers ON + a file named `include` (and `end-include`, `include-ref`) in
the PRD dir → assert `resolve(resolve(x)) === resolve(x)`.

### Rejected alternatives
- *Special-case HTML comments in the resolver* — rejected: too invasive, and the resolver must not
  grow comment-awareness. The markers themselves must be non-resolvable.
- *Rely on the marker words being unlikely filenames* — rejected: this is the bug (environmental
  coincidence), not a fix.

---

## BUG-002 — Idempotency breaks for include chains deeper than `PRD_INCLUDE_MAX_DEPTH`
**Severity**: Minor · **ID**: BUG-002 · **Spec violated**: §2.3 L27 (unconditional idempotency MUST).

### Location
`src/core/session-utils.ts:479` — depth gate inside `expandIncludesRecursive`:
```ts
if (depth >= maxDepth) {
  return content; // depth gate — remaining @tokens stay literal
}
```

### Root cause
The gate returns the boundary file's body **UNSCANNED**. Any `@token` in that body whose target file
**exists** (is resolvable) survives as a literal resolvable survivor. On a 2nd resolution pass those
survivors sit at depth 0 and **expand**, so `resolve(resolve(x)) !== resolve(x)` — violating L27's
unconditional MUST. The global-flat-dedup does NOT bound this case because each file in a **linear
chain is unique** (dedup only bounds cycles/diamonds/back-edges). `maxDepth` was assumed to be
"defense-in-depth" that "dedup itself bounds recursion" (L24) — true for cycles/diamonds, false for
deep unique chains.

### Reachability
- Default `maxDepth=10` (`getPrdIncludeMaxDepth`, `src/config/constants.ts:1272`): requires an **11+**
  deep linear chain (pathological; the project's own `spec/SPEC.md` is depth 1, real specs ≈2–3).
- **Lowered `PRD_INCLUDE_MAX_DEPTH`** (a supported, documented config, §9.7.5 / `hack-config.ts:403`):
  reachable with realistic inputs when a user sets the limit below their actual include depth.

### Reproduction (from the bug report)
1. 12-deep chain: `l{i}.md` = (i==12?'LEAF':`L${i} @l${i+1}.md`); `main.md`='@l1.md'.
2. `o1 = resolvePRD('tmp/main.md')` (default `maxDepth=10`); `o1` ends with `'…L10 @l11.md'`
   (the `@l11.md` token survives literal at the depth-10 boundary).
3. write `tmp/r2.md`=o1; `o2 = resolvePRD('tmp/r2.md')`.
4. `o2 !== o1` — the surviving `@l11.md` expands on pass 2 → `o2` ends `'…L10 L11 LEAF'`.
   (Also reproducible at any N: `opts.maxDepth=3` with a 5-deep chain.)

### Recommended fix
At the depth gate, **scan the content and neutralize resolvable survivors** so none reach a 2nd pass
— mirroring the existing elision semantics (`:492-501`):
- For each `@token` at the boundary: `stat()` it.
  - **Resolves to an existing FILE** → **ELIDE**: markers off → drop the token (emit nothing); markers
    on → emit the **BUG-001-fixed collision-proof** `<!-- @include-ref: token -->` reference comment
    (identical to the dedup-elision branch at `:492-501`, so it inherits non-resolvability).
  - **Does NOT resolve** (ENOENT / directory) → leave **VERBATIM** (a non-resolvable prose mention
    re-resolves identically on pass 2 → still idempotent).
- Do **NOT** recurse (that is the cap's purpose) and do **NOT** add boundary tokens to `visited`.
- **Preserve the stale-warning contract**: elided (resolvable) tokens emit NO warning (elision =
  success). Do not introduce NEW warnings for depth-exceeded non-resolvable tokens.

This makes depth-exceeded resolvable tokens behave EXACTLY like cycle/diamond elision (already
accepted behavior) and restores the unconditional idempotency MUST.

### Behavior change to lock in via tests
Depth-exceeded **resolvable** tokens now **ELIDE** (dropped, or ref-commented with markers on) instead
of staying literal. The 3 existing depth tests in `tests/unit/core/prd-resolve.test.ts` assert the
OLD literal-survivor behavior and MUST be updated:
- **`:190`** "stops expanding at opts.maxDepth (deeper tokens stay literal)" — `expect(out).toBe('A @b.md')`
  → now `@b.md` elides → `'A '` (b.md exists ⇒ resolvable ⇒ elided).
- **`:208`** "stops expanding at opts.maxDepth = 0 (entry returned verbatim)" — `expect(out).toBe('@a.md')`
  → `@a.md` elides → `''`. **Decision point**: uniform elision at the entry (maxDepth=0) yields empty
  output; confirm it is idempotent (`resolve('') === ''`) and document it. (If the team prefers the
  entry to stay raw for maxDepth=0, that is a documented exception — but it re-opens BUG-002 for that
  case, so uniform elision is recommended for a clean guarantee.)
- **`:220`** "stops expanding at the default depth bound" — asserts `.toContain('@l11.md')` (literal)
  → now `.not.toContain('@l11.md')`; levels 1–10 still inline; `@l11.md` elided.

New regression tests (TDD, written FIRST): (a) 12-deep linear chain, default `maxDepth`, assert
fixed point; (b) `opts.maxDepth=3` with a 5-deep chain, assert fixed point; (c) markers ON at the
boundary emits the collision-proof ref-comment AND is a fixed point.

### Rejected alternatives
- *"Document only"* (scope L27 idempotency to "within `PRD_INCLUDE_MAX_DEPTH`") — rejected: it leaves
  the spec's **unconditional** MUST violated. The elide fix actually restores it, with behavior
  consistent with existing elision. (Documenting the boundary semantics in JSDoc is still done —
  Mode A — but as a description of the fixed behavior, not a weakening of the guarantee.)

---

## Cross-cutting
- **Ordering**: BUG-002's boundary elision emits the BUG-001 marker format ⇒ BUG-002 subtask depends
  on BUG-001 subtask. Both edit `expandIncludesRecursive` in the same file ⇒ sequence (not parallel)
  to avoid conflicts.
- **TDD (SOW §3)**: every subtask writes its failing regression test FIRST, then implements, then
  passes. No separate "write tests" subtasks.
- **Docs (SOW §5)**: per-file JSDoc + test comments ride with each fix (Mode A); a final task sweeps
  README.md / overview docs for the changeset (Mode B).