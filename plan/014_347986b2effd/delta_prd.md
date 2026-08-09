# Delta PRD: Distributed-PRD Include Dedup (each file imported at most once)

> **Delta scope.** This delta captures the single substantive change between the
> session-013 baseline PRD and the current PRD: the include-resolution semantics in
> **§2.3 (Distributed (Multi-File) PRDs)** were changed from a *per-branch ancestry
> cycle check* to a *global flat dedup with elision*. All other text in the PRD is
> byte-identical except two markdown tables (§9.2.9 reasoning-role table, §9.7.5
> `.hack` schema table) which were reflowed for column width — **identical data,
> cosmetic only, no behavior**, and therefore out of scope for this delta.
>
> **Reference prior work.** Session 013 (Per-Role Reasoning Level) is unrelated to
> include resolution; its `plan/013_*/architecture/` research does not cover this
> subsystem. The change site is fully localized to `src/core/session-utils.ts`
> (the include resolver) and its tests.

## The Change (§2.3 — Expansion rules, No duplication, Idempotency)

### What changed

The PRD's include-resolution model was rewritten. Old vs. new:

**OLD (per-branch ancestry / cycle detection).** A file is expanded recursively,
guarded only by a *path-based ancestry* `visited` set that is **copied on each
descent** (`new Set(visited).add(abs)`). The explicit, intended consequence was
that **diamond includes expand the shared file in every branch** — `A→C` and
`B→C` injects `C` twice — and the only thing the set prevents is a true cycle
(a file re-entering its own ancestry). `PRD_INCLUDE_MAX_DEPTH` (default 10) is the
sole recursion bound. This is exactly what the current code implements and
documents (see `expandIncludesRecursive` + `resolvePRD` JSDoc in
`src/core/session-utils.ts`, which actively describe per-branch diamond
expansion as the correct behavior).

**NEW (global flat dedup with elision).** A given file is expanded **at most
once across the entire resolution**. The resolver keeps a single
**global, flat visited set keyed on the resolved absolute path** — shared across
the whole document, **not** copied per branch — so a diamond dependency
(`A→C` and `B→C`) injects `C` **exactly once**. The first encounter wins, in
document order (a parent file's body is emitted around its child references in
their natural textual positions). A subsequent reference to an already-imported
file is **elided** from the resolved document (the `@token` is dropped); when
`PRD_INCLUDE_MARKERS` is on it is instead replaced by a **stable reference
comment that names the path but contains no resolvable `@token` of its own**.
Elision — not verbatim survival — is mandatory (a verbatim survivor would
re-expand on the next pass and break idempotency). `PRD_INCLUDE_MAX_DEPTH`
remains as a **defense-in-depth** recursion cap only; dedup itself bounds
recursion, so cycles and diamond dependencies terminate without relying on it.

**Why.** Without dedup, a densely cross-referenced spec (section files that
mutually `@`-reference one another) expands **exponentially with depth** until
it overflows the runtime's maximum string length and crashes the resolver
mid-pipeline. Dedup makes the resolved document a true **fixed point**:
`resolve(resolve(x)) === resolve(x)` — the only `@token`s that survive a
resolution are non-resolving prose mentions, which re-resolve identically
(still non-resolving); every resolvable token has been expanded once or
elided, so a second pass has nothing new to expand. This is the property that
guarantees hash/snapshot/delta consistency (§4.1, §4.3).

This **reverses a prior documented design decision** (the current code's
JSDoc asserts the opposite — "a flat/global set would wrongly deduplicate
diamonds"). The new PRD mandates the flat/global set.

## Implementation impact

The change is localized to the include resolver in **`src/core/session-utils.ts`**
and its tests. Downstream consumers (`session-manager.ts`, `prp-pipeline.ts`,
`prd-selector.ts`, `effective-prd.ts`) all call `resolvePRD()` and read its output
verbatim; they need **no** changes — the resolved document they already consume
becomes smaller (deduplicated) and remains a valid merged document.

### Requirement 1 — Global flat dedup with elision in `expandIncludesRecursive`

Rewrite the recursive worker so the `visited` set is a single **global,
shared, flat** set keyed on the resolved absolute path (passed **by reference**
on descent, not copied), and an already-imported path is **elided** rather
than left literal:

- **Dedup, not ancestry.** Replace `new Set(visited).add(abs)` (per-branch copy)
  with mutation of the shared set: mark `abs` visited before descending into it
  and pass the **same** set down. A diamond (`A→C` and `B→C`) resolves `C` once;
  the second `@C` reference finds `visited.has(abs)` true.
- **Elide on second encounter.** When `visited.has(abs)` is already true, the
  `@token` is **dropped** from the output (not echoed verbatim). With
  `markers` on, emit a **stable reference comment** naming the path that
  contains **no resolvable `@token`** of its own (e.g. `<!-- @include-ref: path
  -->` — a comment, so it cannot match `INCLUDE_TOKEN` on a re-scan). The exact
  comment wording is an implementation detail; the contract is "names the path,
  contains no `@token`".
- **First-encounter order.** The first textual occurrence of a path expands it
  inline (with optional markers around the expanded body, exactly as today);
  later occurrences only elide. The current loop already iterates in document
  order, so this falls out naturally once the shared set replaces the copy.
- **Entry seeding.** `resolvePRD` already seeds `visited` with the entry's
  absolute path; keep that (an include pointing back at the entry is elided,
  not cycled).
- **Max-depth remains a cap.** Keep the `depth >= maxDepth` gate; it is now a
  defense-in-depth safety valve only (dedup bounds recursion). No behavior
  change at the gate itself.
- **Stale-include warning unaffected.** The existing `.md`-token stderr warning
  fires only when a token fails to resolve (ENOENT/dir). Elision of an
  already-imported file is a *successful* resolution (the path resolved and was
  expanded on first encounter), so it emits **no** warning — keep the warning
  condition exactly as today.

  - **Mode A docs (ride with the work):** Rewrite the JSDoc on
    `expandIncludesRecursive`, `resolveIncludes`, and `resolvePRD` in
    `src/core/session-utils.ts`. The current JSDoc **actively describes the old
    per-branch behavior** ("the visited set is per-branch, not flat"; "diamond
    includes still expand `c` in both branches"; "a flat/global set would
    wrongly deduplicate diamonds") and is now **factually wrong** — these
    comments must describe the global-flat-dedup + elision model and cite
    §2.3. Also update the inline comments at the `new Set(visited)` site and
    the `visited.has(abs)` branch.

### Requirement 2 — Tests for the new dedup / elision / idempotency semantics

The existing tests assert the **old** per-branch semantics (a diamond expands
`C` in both branches; a cycle back-edge is left literal). They must be
rewritten to assert the **new** contract, and the key new invariants added:

- **Diamond dedup.** A fixture `A → B`, `A → C`, `B → D`, `C → D` resolves `D`
  **exactly once** (in its first-encounter position), and the second `@D`
  reference is **elided** (not present in output). Assert the resolved document
  contains `D`'s body exactly once.
- **Marker-mode reference comment.** With `markers: true`, the elided second
  reference is replaced by a **stable reference comment** that names the path;
  assert the comment is present, contains no resolvable `@token`, and that a
  second resolution pass over the marker-on output is byte-identical (the
  comment does not trigger re-expansion).
- **No-marker elision.** With markers off (default), the elided reference is
  simply **absent** (the `@token` dropped); assert the resolved output contains
  no `@D` survivor.
- **Idempotency (fixed point).** `resolve(resolve(x)) === resolve(x)` for a
  diamond-heavy fixture. This is the headline invariant the dedup exists to
  guarantee — assert it directly.
- **Exponential-blowup guard (regression).** A fixture of N mutually
  `@`-referencing files resolves to output whose size is **linear in the sum of
  file sizes**, not exponential in N. (Before this change such a fixture would
  blow up; this test locks in the fix.)
- **Entry-is-its-own-cycle.** An include pointing back at the entry file is
  elided (it is seeded in `visited`), not expanded a second time.
- **Single-level `resolveIncludes`.** Verify the single-level entry point's
  contract is unchanged where it does not recurse (it is not the dedup target,
  but confirm a direct duplicate `@token` within one entry file still expands
  both inline, OR decide and document — single-level dedup across siblings is
  out of the diamond problem; match whatever the shared lower-level scan does).
  If `resolveIncludes` is now a thin/unused shim, note it; do not expand scope.

  - **Mode A docs (ride with the work):** Test descriptions / `describe` blocks
    should name the §2.3 invariant they lock in (dedup / elision /
    idempotency), so a future reader understands *why* each test exists.

## Notes for the breakdown agent

- **One module, two cohesive tasks.** This is a single algorithm change to one
  file (`src/core/session-utils.ts`) plus its tests. Do **not** fan it out into
  multiple phases or milestones; the proportional breakdown is **1 phase → 1
  milestone → 2 tasks** (implement dedup+elision+JSDoc; rewrite tests). Resist
  splitting the algorithm change from its JSDoc — the JSDoc rewrite is part of
  the implementation task because the current comments contradict the new code.
- **Read the real code first.** `expandIncludesRecursive` and `resolvePRD` in
  `src/core/session-utils.ts` are the change sites; `INCLUDE_TOKEN` /
  `RESOLVE_TOKEN`, `readUTF8FileStrict`, `getPrdIncludeMaxDepth`, and
  `getPrdIncludeMarkers` are the supporting pieces. The current JSDoc on these
  functions is the single best map of the existing per-branch logic that must
  be replaced.
- **Do not chase the cosmetic table changes.** §9.2.9 and §9.7.5 were column
  reflow only; they touch no code and require no tasks.
- **No Mode B (changeset-level) docs.** Include resolution is an internal
  subsystem; there is no README/feature-blurb or top-level capability list that
  summarizes it for end users. The Mode A JSDoc rewrite in Requirement 1 is the
  entire documentation surface for this delta. Do not invent user-facing doc
  pages.
- **Out of scope.** The downstream callers (`session-manager.ts`,
  `prp-pipeline.ts`, `prd-selector.ts`, `effective-prd.ts`) read the resolved
  document verbatim and need no edits. `PRD_INCLUDE_MAX_DEPTH` behavior, the
  stale-include stderr warning, and the optional-include-markers format around
  *expanded* bodies are all unchanged.