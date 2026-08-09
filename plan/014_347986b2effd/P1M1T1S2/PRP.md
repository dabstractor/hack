# PRP — P1.M1.T1.S2: Rewrite JSDoc on `resolvePRD` and `resolveIncludes` to match the new dedup model

> PRD §2.3 (Distributed/Multi-File PRDs). S1 (LANDED) rewrote `expandIncludesRecursive` to
> GLOBAL-FLAT-DEDUP + ELISION and rewrote its OWN JSDoc (the terminology template). **S2 rewrites the
> JSDoc on the two PEER functions** (`resolvePRD`, `resolveIncludes`) + the IDENTITY @remarks that
> references `resolvePRD`, so all three functions' docs consistently describe the new model. **JSDoc +
> inline comments ONLY — no code logic changes.** Test rewrites are P1.M1.T2 (separate).

---

## Goal

**Feature Goal**: Replace the stale per-branch / S1-S2-S3-staging JSDoc on `resolvePRD` and
`resolveIncludes` (and the IDENTITY @remarks) in `src/core/session-utils.ts` with accurate descriptions
of the new global-flat-dedup + elision model, matching the terminology S1 already landed on
`expandIncludesRecursive`. Cite PRD §2.3 throughout.

**Deliverable**: `src/core/session-utils.ts` — rewritten JSDoc `@remarks` blocks (and a few inline
comments) on `resolvePRD` (~L544-592), `resolveIncludes` (~L336-369) + `ResolveOpts.maxDepth`
(~L324-327), and the IDENTITY @remarks (~L241). No other file. No code logic.

**Success Definition**:
- `resolvePRD`'s @remarks describes GLOBAL FLAT DEDUPLICATION (single shared visited set, first-encounter
  expands, subsequent refs elided, entry pre-seeded), a TRUE FIXED POINT (`resolve(resolve(x)) === resolve(x)`),
  maxDepth as DEFENSE-IN-DEPTH, and the `<!-- @include-ref: token -->` marker for elided refs.
- `resolveIncludes`'s @remarks describes it as the SINGLE-LEVEL, NOT-dedup-aware primitive and cross-
  references `resolvePRD`/`expandIncludesRecursive` as the recursive dedup-aware path — with NO remaining
  S1/S2/S3 staging language.
- The IDENTITY @remarks references `resolvePRD`'s true-fixed-point guarantee (no "(S3)" tag).
- No stale staging tags remain in these blocks ("= S2", "= S3", "(S1)", "(S3)", "per-branch, not flat",
  "NOT a fixed point", "recursive depth-decrementing loop lands in S2").
- `npm run typecheck && npm run lint && npm run format:check` clean; the include/resolve test suites are
  UNCHANGED (comments-only change).

---

## Why

- **Documentation accuracy after a behavior change.** S1 changed the resolver from per-branch ancestry to
  global-flat-dedup + elision — a fundamentally different model. The JSDoc on the two peer functions still
  describes the OLD model (per-branch visited set; "diamond expands c in both branches"; "depth-exceeded
  is NOT a fixed point"; "S1/S2/S3 staging"). Stale docs actively mislead the next reader/implementer.
- **Consistency with S1's canonical wording.** S1 rewrote `expandIncludesRecursive`'s JSDoc with precise
  new terminology (GLOBAL-FLAT-DEDUP, ELISION, idempotent fixed point, defense-in-depth). S2 propagates
  that SAME terminology to the peer functions so the three functions read as one coherent model.
- **PRD §2.3 is the source of truth.** The PRD's "No duplication (dedup)" + "Idempotency" clauses are the
  authoritative spec; the JSDoc must cite and match them.
- **Scope discipline.** S2 = JSDoc + inline comments on the two peer functions + the IDENTITY block ONLY.
  S1 owns `expandIncludesRecursive` (code + its JSDoc + its inline comments). P1.M1.T2 owns the test
  rewrites. No code logic changes in S2.

---

## What

### User-visible behavior
None (documentation-only).

### Technical requirements (exact contract)

All edits are in `src/core/session-utils.ts`, JSDoc + inline comments ONLY (no code logic). Match the
terminology in `expandIncludesRecursive`'s JSDoc (L425-463, S1-landed).

**(a) `resolvePRD` @remarks (~L548-577) — rewrite the bullets:**
- **IDEMPOTENCY** → TRUE FIXED POINT: "The resolved document is an idempotent fixed point —
  `resolve(resolve(x)) === resolve(x)` (PRD §2.3). Global-flat-dedup via elision ensures every resolvable
  token is expanded once or elided on the first pass, leaving no resolvable survivors; the only `@token`s
  that survive are non-resolving prose mentions, which re-resolve identically. This is the property that
  guarantees §4.1 hashing, §4.3 delta detection, and `prd_snapshot.md` consistency."
- **CYCLE DETECTION** → **GLOBAL FLAT DEDUPLICATION** (replaces the bullet entirely): "A single global
  visited set, keyed on the resolved absolute path, is shared across the whole resolution (passed by
  reference into {@link expandIncludesRecursive}, never copied per branch). The first textual encounter of
  a file expands it inline; EVERY subsequent reference — in a sibling branch (diamond A→C and B→C), a
  cycle, or a back-edge — is ELIDED (the `@token` is dropped, or replaced by a non-resolvable
  `<!-- @include-ref: token -->` comment when markers are on). The entry file is pre-seeded in the visited
  set, so self-includes are elided. This bounds recursion to one import per file, so cycles and diamond
  dependencies terminate without relying on `maxDepth` (PRD §2.3 'No duplication')."
- **MAX DEPTH** → "now DEFENSE-IN-DEPTH only: the global-flat-dedup already bounds recursion to one import
  per file; `maxDepth` (default {@link getPrdIncludeMaxDepth}, 10) is a backstop against pathological
  inputs. The entry file is depth 0."
- **MARKERS** → ADD the elided-ref marker: keep the `<!-- @include: path -->` / `<!-- @end-include -->`
  wrapping for EXPANDED includes, and ADD that elided references emit `<!-- @include-ref: token -->`
  (a non-resolvable comment — no `@`-preceded token — so it is idempotent on re-scan). Fix "Literal
  survivors (missing/dir/cycle/depth)" → cycles now ELIDE (not literal); missing/dir are the literal
  survivors; depth-exceeded is the rare defense-in-depth case.
- **BASE INVARIANT** → UNCHANGED.
- **STALE-INCLUDE WARNING** → UNCHANGED (still accurate: elision is a successful resolution → no warning;
  only ENOENT/dir tokens warn).
- **Summary line (~L579)**: "Missing files, directories, and cycle back-edges stay verbatim." → FIX:
  "Missing files and directories stay verbatim; already-imported references (cycles, diamonds, back-edges)
  are ELIDED (dropped, or a `<!-- @include-ref -->` comment when markers are on)."
- **Inline comment (~L600)** in the resolvePRD body: "S3: marker toggle (opts wins over env)" → drop the
  "S3" staging tag (e.g. "marker toggle (opts wins over env)").

**(b) `resolveIncludes` @remarks (~L339-353) — single-level + not-dedup-aware:**
- Replace "**SINGLE-LEVEL in S1**: ... recursive expansion + cycle detection = S2; markers + stale-include
  warnings = S3." with: "**SINGLE-LEVEL primitive**: each resolved `@token` is replaced inline by its
  file's UTF-8 contents verbatim; the substituted content is NOT re-scanned. This function is NOT
  dedup-aware — it does not recurse and does not maintain a visited set, so it neither elides duplicates
  nor bounds cycles (a diamond through it would duplicate; a cycle would recurse up to `maxDepth`). For
  the recursive, global-flat-dedup-aware resolution used in production, use {@link resolvePRD} (which
  delegates to {@link expandIncludesRecursive})."
- KEEP the BOUNDARY + EXISTENCE rules (accurate); drop the trailing "idempotency-friendly for S3" phrase.

**(c) `ResolveOpts.maxDepth` @remarks (~L324-327):**
- Replace "In S1 this is honored only as the base-case depth gate ... The recursive depth-decrementing
  loop lands in S2." with: "The max-depth gate. {@link resolvePRD}'s recursive resolver honors it as a
  DEFENSE-IN-DEPTH backstop (the global-flat-dedup is the primary recursion bound); {@link resolveIncludes}
  honors it as its single-level gate (a depth `< 1` returns content unchanged). Defaults to
  {@link getPrdIncludeMaxDepth}."

**(d) `resolveIncludes` body inline comment (~L400):**
- "missing → silent verbatim (S3 adds the .md-token stderr warning)." → "missing → silent verbatim (the
  stale-include stderr warning lives in {@link expandIncludesRecursive}, the recursive resolver; this
  single-level primitive is silent on stale includes)."

**(e) IDENTITY @remarks (~L241):**
- "Idempotency of {@link resolvePRD} (S3) makes a single resolution safe." → "resolvePRD produces a TRUE
  FIXED POINT (`resolve(resolve(x)) === resolve(x)`, PRD §2.3), so a single resolution is safe."

### Success Criteria
- [ ] `resolvePRD` @remarks: GLOBAL FLAT DEDUPLICATION + TRUE FIXED POINT + maxDepth defense-in-depth + elided-ref marker.
- [ ] `resolveIncludes` @remarks: single-level + NOT dedup-aware + cross-ref resolvePRD/expandIncludesRecursive; no S1/S2/S3 staging.
- [ ] `ResolveOpts.maxDepth` @remarks: no "lands in S2"; describes the defense-in-depth backstop.
- [ ] IDENTITY @remarks: true-fixed-point guarantee; no "(S3)".
- [ ] Summary line + inline comments fixed (cycle back-edges elide not verbatim; "S3" tags dropped).
- [ ] NO code logic changes (JSDoc + inline comments only).
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; include/resolve tests UNCHANGED.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement
this successfully?_ **Yes** — S1's canonical terminology (verbatim, with line numbers), each stale
JSDoc block (verbatim current text + the precise replacement), the exact line sites, the "no code logic"
constraint, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — the new model (authoritative) + the canonical terminology to match
- docfile: plan/014_347986b2effd/architecture/system_context.md
  why: Describes the global-flat-dedup + elision + true-fixed-point model S1 implemented and S2 must document.
# PRD §2.3 (provided inline in <selected_prd_content>) — "No duplication (dedup)" + "Idempotency" are the source of truth.

# MUST READ — exact stale blocks + replacements + the no-code-logic constraint + out-of-scope list
- docfile: plan/014_347986b2effd/P1M1T1S2/research/jsdoc-rewrite-design.md
  section: "2. resolvePRD JSDoc" and "3. resolveIncludes JSDoc" and "5. Out of scope"
  why: Verbatim current text of each stale bullet + the precise rewrite + the resolveIncludes-is-single-level accuracy note.

# PATTERN FILE — the ONLY file edited; S1's canonical JSDoc is the terminology template
- file: src/core/session-utils.ts
  why: S1's expandIncludesRecursive JSDoc (L425-463) is the CANONICAL wording for the new model — MATCH its
        terminology (GLOBAL-FLAT-DEDUP, ELISION, "idempotent fixed point: resolve(resolve(x)) === resolve(x)",
        "DEFENSE-IN-DEPTH"). The stale blocks S2 rewrites: resolvePRD @remarks (L548-577) + summary (L579) +
        inline (L600); resolveIncludes @remarks (L339-353) + ResolveOpts.maxDepth (L324-327) + inline (L400);
        IDENTITY @remarks (L241).
  pattern: "GLOBAL-FLAT-DEDUP ... visited set is a SINGLE shared set, passed by REFERENCE ... ELIDED ... idempotent fixed point"
  gotcha: Do NOT touch expandIncludesRecursive (L425-535) — S1 owns it (code + JSDoc + inline comments). Its
        inline "S3" comments (L519/524/534) are S1's to clean up, NOT S2's.

# VERIFIED FACTS
- fact: "S1 is LANDED. expandIncludesRecursive JSDoc (L425-463) already describes global-flat-dedup + elision + true-fixed-point. S2 matches that terminology on the peer functions."
- fact: "resolveIncludes is NOT consumed in src/ production code (only in tests/unit/core/prd-includes.test.ts + a constants.ts JSDoc ref). The production path is resolvePRD → expandIncludesRecursive. So resolveIncludes' JSDoc must honestly describe it as a single-level LOW-LEVEL primitive, NOT the production resolver."
- fact: "Cycle back-edges now ELIDE (dropped or <!-- @include-ref: token -->), NOT stay verbatim. The resolvePRD summary line L579 ('cycle back-edges stay verbatim') is now WRONG and must be fixed."
- fact: "Elision is a SUCCESSFUL resolution (file exists + was expanded on first encounter) → it NEVER triggers the stale-include warning (only ENOENT/dir does). The STALE-INCLUDE WARNING bullet stays accurate — unchanged per contract."
```

### Current Codebase tree (relevant slice)

```bash
src/core/session-utils.ts   # EDIT — JSDoc + inline comments on resolvePRD, resolveIncludes, ResolveOpts.maxDepth, IDENTITY @remarks
# expandIncludesRecursive (L425-535) = READ-ONLY (S1 owns). No other file. No code logic. No tests.
```

### Desired Codebase tree with files to be added/edited

```bash
src/core/session-utils.ts   # MODIFIED (JSDoc + inline comments ONLY — no code logic)
# No new files. No tests (P1.M1.T2). No other source files.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — JSDoc + INLINE COMMENTS ONLY. Do NOT change any code logic (no statement edits, no signature
//   changes). typecheck/lint must be unaffected apart from comment reformatting.

// CRITICAL — do NOT touch expandIncludesRecursive (L425-535) — S1 owns that function entirely (code + its
//   JSDoc + its inline comments, including the "S3" comments at L519/524/534). S2's scope is resolvePRD +
//   resolveIncludes + ResolveOpts.maxDepth + the IDENTITY @remarks ONLY.

// CRITICAL — match S1's CANONICAL terminology on expandIncludesRecursive (L425-463): "GLOBAL-FLAT-DEDUP",
//   "ELISION", "idempotent fixed point: resolve(resolve(x)) === resolve(x)", "DEFENSE-IN-DEPTH". Do not
//   invent new wording that diverges from S1's JSDoc.

// CRITICAL — cycle back-edges now ELIDE (not verbatim). The resolvePRD summary line L579 ("cycle back-edges
//   stay verbatim") is now FACTUALLY WRONG — fix it. (Diamond/cycle/back-edge refs are all elided.)

// GOTCHA — resolveIncludes is NOT dedup-aware and is NOT the production resolver (resolvePRD is). Its
//   JSDoc must HONESTLY say so (single-level primitive; cross-ref the recursive path). Do NOT claim it dedups.

// GOTCHA — the STALE-INCLUDE WARNING bullet in resolvePRD is UNCHANGED per contract (elision = successful
//   resolution → no warning; only ENOENT/dir warns — still accurate). Don't rewrite it.

// GOTCHA — drop ALL stale staging tags in the S2-scoped blocks: "= S2", "= S3", "(S1)", "(S3)",
//   "per-branch, not flat", "NOT a fixed point", "recursive depth-decrementing loop lands in S2".
//   (expandIncludesRecursive's "S3" inline comments are S1's — leave them.)

// GOTCHA — prettier is ERROR-enforced. JSDoc reformatting (bullet width, line wrapping) may need `npm run fix`.

// GOTCHA — src/config/constants.ts:1290 ("consumed by S1's resolveIncludes") is a stale ref in a DIFFERENT
//   file — out of S2's scope (contract = session-utils.ts only). Flag it in the commit message; do not edit.

// GOTCHA — do NOT run the full `npm run test:run` as the gate. P1.M1.T2's test rewrites (diamond/cycle/
//   idempotency) may be in flux. S2's gate: typecheck + lint + format + the include/resolve suites UNCHANGED.
```

---

## Implementation Blueprint

### Data models and structure
None — JSDoc + inline comments only. No types/constants/code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/core/session-utils.ts — rewrite resolvePRD @remarks + summary + inline comment
  - IDEMPOTENCY bullet → TRUE FIXED POINT (resolve(resolve(x)) === resolve(x); cite §4.1/§4.3).
  - CYCLE DETECTION bullet → GLOBAL FLAT DEDUPLICATION (single shared visited set; first-encounter expands;
        subsequent refs elided; entry pre-seeded; cycles/diamonds terminate without maxDepth; cite §2.3).
  - MAX DEPTH bullet → defense-in-depth only (dedup bounds recursion; maxDepth is a backstop).
  - MARKERS bullet → ADD the <!-- @include-ref: token --> marker for elided refs; fix "cycle/depth" survivors
        (cycles elide; depth-exceeded is the rare defense-in-depth case).
  - BASE INVARIANT + STALE-INCLUDE WARNING bullets → UNCHANGED.
  - Summary line (~L579) → "Missing files and directories stay verbatim; already-imported references
        (cycles/diamonds/back-edges) are ELIDED."
  - Inline comment (~L600) → drop the "S3" tag.
  - DO NOT change resolvePRD's code logic or signature.

Task 2: EDIT src/core/session-utils.ts — rewrite resolveIncludes @remarks + ResolveOpts.maxDepth + inline
  - resolveIncludes @remarks → SINGLE-LEVEL primitive, NOT dedup-aware (no recursion, no visited set, no
        elision); cross-ref resolvePRD/expandIncludesRecursive as the recursive dedup-aware path. Drop the
        "S1/S2/S3" staging + "idempotency-friendly for S3".
  - ResolveOpts.maxDepth @remarks → defense-in-depth backstop for resolvePRD; single-level gate for
        resolveIncludes. Drop "lands in S2".
  - resolveIncludes body inline (~L400) → the stale-include warning lives in expandIncludesRecursive;
        this single-level primitive is silent on stale includes. Drop "S3".
  - DO NOT change resolveIncludes' code logic or signature.

Task 3: EDIT src/core/session-utils.ts — IDENTITY @remarks (~L241)
  - "Idempotency of resolvePRD (S3) makes a single resolution safe." → "resolvePRD produces a TRUE FIXED
        POINT (resolve(resolve(x)) === resolve(x), PRD §2.3), so a single resolution is safe."

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts
        → UNCHANGED (comments-only; no behavior change).
  - GREP: confirm NO stale staging tags remain in the S2-scoped blocks (resolvePRD/resolveIncludes/
        ResolveOpts.maxDepth/IDENTITY): `grep -n "= S2\|= S3\|(S1)\|(S3)\|per-branch, not flat\|NOT a fixed point\|lands in S2" src/core/session-utils.ts`
        → the only remaining hits (if any) should be inside expandIncludesRecursive (S1's scope, L425-535).
  - EXPECTED: clean; suites unchanged; no stale tags in S2's blocks.
```

### Implementation Patterns & Key Details

```ts
// ---- resolvePRD @remarks: the two key rewritten bullets (match S1's expandIncludesRecursive wording) ----
//  - **GLOBAL FLAT DEDUPLICATION** (PRD §2.3): a single visited set keyed on the resolved absolute path is
//    shared across the whole resolution (passed by reference into expandIncludesRecursive, never copied per
//    branch). The first textual encounter of a file expands it inline; EVERY subsequent reference (diamond,
//    cycle, back-edge) is ELIDED — dropped (markers off) or replaced by a non-resolvable
//    `<!-- @include-ref: token -->` comment (markers on). The entry file is pre-seeded, so self-includes
//    elide. Recursion is bounded to one import per file, so cycles/diamonds terminate without maxDepth.
//  - **IDEMPOTENCY**: the resolved document is a TRUE FIXED POINT — `resolve(resolve(x)) === resolve(x)`.
//    Dedup-via-elision leaves no resolvable survivors; only non-resolving prose mentions survive (re-resolve
//    identically). Guarantees §4.1 hashing, §4.3 delta detection, prd_snapshot.md consistency.

// ---- resolveIncludes @remarks: the single-level honesty ----
//  **SINGLE-LEVEL primitive**: each resolved @token is replaced inline by its file's contents verbatim;
//  substituted content is NOT re-scanned. NOT dedup-aware — no recursion, no visited set, no elision (a
//  diamond duplicates; a cycle recurses up to maxDepth). For the recursive, dedup-aware production path,
//  use resolvePRD (→ expandIncludesRecursive).

// ---- IDENTITY @remarks: the fixed-point note ----
//  resolvePRD produces a TRUE FIXED POINT (resolve(resolve(x)) === resolve(x), PRD §2.3), so a single
//  resolution is safe.
```

### Integration Points

```yaml
NONE — JSDoc + inline comments only. No code logic, no callers, no tests changed. The doc accuracy
  propagates to future readers/implementers of resolvePRD/resolveIncludes. P1.M1.T2 (test rewrites) is the
  sibling subtask that asserts the new behavior; S2 is purely the documentation alignment.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run first — JSDoc reformatting may need it)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean (comments don't affect types)
npm run lint && npm run format:check   # clean
# Expected: clean. If typecheck errors, you accidentally edited code logic — revert to comments-only.
```

### Level 2: Unit Tests (must be UNCHANGED — comments-only)

```bash
npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts
# Expected: UNCHANGED (same pass/fail as before S2). S2 is comments-only — no behavior change. If a test
# result CHANGED, you accidentally edited code logic. (Note: P1.M1.T2's test REWRITES are separate and may
# be in flux — S2 does not touch tests.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — JSDoc + inline comments with no runtime surface. A grep proof that no stale staging tags remain in
# S2's blocks:
grep -n "= S2\|= S3\|(S1)\|(S3)\|per-branch, not flat\|NOT a fixed point\|lands in S2" src/core/session-utils.ts
# Expected: any remaining hits are INSIDE expandIncludesRecursive (L425-535, S1's scope). ZERO hits in the
# resolvePRD / resolveIncludes / ResolveOpts.maxDepth / IDENTITY blocks.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A — documentation-only. Domain checks (record in commit message):
#   - resolvePRD @remarks now matches S1's expandIncludesRecursive terminology (global-flat-dedup + elision + true fixed point).
#   - resolveIncludes honestly described as single-level + not-dedup-aware (it is NOT the production resolver).
#   - Cycle back-edges ELIDE (the old "stay verbatim" was wrong post-S1) — summary line fixed.
#   - No code logic changed; no tests changed; expandIncludesRecursive (S1) untouched.
#   - constants.ts:1290 stale ref flagged (out of scope; different file).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-includes.test.ts tests/unit/core/prd-resolve.test.ts` UNCHANGED.

### Feature Validation
- [ ] `resolvePRD` @remarks: GLOBAL FLAT DEDUPLICATION + TRUE FIXED POINT + maxDepth defense-in-depth + elided-ref marker.
- [ ] `resolveIncludes` @remarks: single-level + NOT dedup-aware + cross-ref resolvePRD/expandIncludesRecursive.
- [ ] `ResolveOpts.maxDepth` @remarks: defense-in-depth backstop; no "lands in S2".
- [ ] IDENTITY @remarks: true-fixed-point guarantee; no "(S3)".
- [ ] resolvePRD summary line fixed (cycle back-edges elide, not verbatim); inline "S3" tags dropped.
- [ ] No stale staging tags in S2's blocks (grep proof).

### Code Quality Validation
- [ ] ONLY `src/core/session-utils.ts` edited; JSDoc + inline comments ONLY (no code logic).
- [ ] `expandIncludesRecursive` (L425-535) UNTOUCHED (S1 owns it).
- [ ] Terminology matches S1's canonical `expandIncludesRecursive` JSDoc.
- [ ] No tests modified (P1.M1.T2 owns test rewrites).

### Documentation & Deployment
- [ ] All three functions (expandIncludesRecursive from S1; resolvePRD + resolveIncludes from S2) now
      describe the global-flat-dedup + elision model consistently and cite §2.3.
- [ ] Commit message notes: JSDoc-only alignment to S1's dedup model; no code/tests changed; expandIncludesRecursive untouched; constants.ts:1290 flagged.

---

## Anti-Patterns to Avoid

- ❌ Don't change any CODE LOGIC — JSDoc + inline comments only. If typecheck/test results change, you
      edited code; revert.
- ❌ Don't touch `expandIncludesRecursive` (L425-535) — S1 owns it (code + JSDoc + inline comments,
      including its "S3" comments). S2's scope is the two peer functions + ResolveOpts.maxDepth + IDENTITY.
- ❌ Don't invent new terminology — MATCH S1's canonical `expandIncludesRecursive` JSDoc (GLOBAL-FLAT-DEDUP,
      ELISION, "idempotent fixed point", DEFENSE-IN-DEPTH).
- ❌ Don't claim `resolveIncludes` dedups — it's single-level and NOT dedup-aware; say so honestly and
      cross-ref the recursive path.
- ❌ Don't leave the resolvePRD summary line saying "cycle back-edges stay verbatim" — they ELIDE now (post-S1).
- ❌ Don't rewrite the STALE-INCLUDE WARNING bullet — it's still accurate (elision = successful resolution →
      no warning); the contract says unchanged.
- ❌ Don't edit `src/config/constants.ts:1290` — different file, out of scope. Flag it in the commit message.
- ❌ Don't touch tests — P1.M1.T2 owns the diamond/cycle/idempotency test rewrites.
- ❌ Don't run the full `npm run test:run` as the gate — P1.M1.T2's test rewrites may be in flux. Gate on
      typecheck + lint + format + the include/resolve suites being UNCHANGED.

---

## Confidence Score

**9/10** — one-pass implementation success likelihood.

Rationale: This is a JSDoc/inline-comment-only task with S1 LANDED (the canonical terminology template is
in-repo at L425-463). Each stale block is identified verbatim with its precise replacement, the line sites
are confirmed, the "no code logic" constraint is explicit, and the one factual error in the current docs
(the "cycle back-edges stay verbatim" summary line, now wrong post-S1) is called out. The scope boundary
(expandIncludesRecursive = S1; tests = P1.M1.T2; constants.ts:1290 = out of scope) is crisp. The only
residual risk is a prettier reformatting nit on the rewritten JSDoc bullets (auto-fixed via `npm run fix`).
No external/runtime unknowns.