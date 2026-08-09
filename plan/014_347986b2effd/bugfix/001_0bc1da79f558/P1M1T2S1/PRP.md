# PRP — P1.M1.T2.S1: Elide resolvable survivors at the depth gate so `resolve(resolve(x))===resolve(x)` (TDD)

> Bugfix `001_0bc1da79f558`, **BUG-002 (MINOR)**. PRD §2.3 L27 mandates UNCONDITIONAL idempotency
> (`resolve(resolve(x)) === resolve(x)`). The depth gate in `expandIncludesRecursive`
> (`src/core/session-utils.ts:479`, `if (depth >= maxDepth) return content`) returns the boundary body
> **UNSCANNED**, so its resolvable `@token`s survive as literal resolvable survivors and EXPAND on a 2nd
> pass → fixed point breaks for deep LINEAR chains (unique files — dedup bounds cycles/diamonds only) or
> lowered `PRD_INCLUDE_MAX_DEPTH`. **Fix: replace the unscanned `return content` with a neutralize-scan
> that ELIDES resolvable survivors (mirroring the dedup-elision branch) and leaves non-resolvable prose
> verbatim.** Depends on S1's (in-flight) collision-proof `@!include-ref` marker format. TDD: failing
> tests first → fix → green.

---

## Goal

**Feature Goal**: Make `resolve(resolve(x)) === resolve(x)` hold for ALL inputs regardless of include
depth or `maxDepth` — within the cap, content expands; beyond the cap, resolvable `@token`s are ELIDED
(not left literal); non-resolvable prose stays verbatim. Replace the depth gate's unscanned
`return content` with a `neutralizeResolvableTokens` scan that `stat()`s each `@token`, elides
resolvable-to-file tokens (markers off → drop; markers on → S1's collision-proof `@!include-ref`
ref-comment), and leaves non-resolvable tokens verbatim. No recursion; no `visited` mutation.

**Deliverable**:
1. **`src/core/session-utils.ts`** — (a) replace the depth-gate `return content` (~:479) with a call to
   a new `neutralizeResolvableTokens(content, baseDir, markers)` helper; (b) add that helper after
   `expandIncludesRecursive` (stat → isFile? elide : verbatim; EACCES throws, ENOENT/dir verbatim);
   (c) [recommended] extract `elisionRefComment(token)` used by BOTH the dedup-elision branch AND the
   gate, so the marker format is a single source; (d) JSDoc updates (expandIncludesRecursive maxDepth
   note ~:454 + resolvePRD MAX DEPTH bullet ~:574) — gate now ELIDES; idempotency unconditional;
   maxDepth=0 entry edge documented.
2. **`tests/unit/core/prd-resolve.test.ts`** — (a) UPDATE the 3 existing depth tests (:190/:208/:220) to
   assert elided (not literal) output; (b) ADD 3 new regression tests (12-deep default-maxDepth fixed
   point; maxDepth=3 + 5-deep fixed point; markers-ON at the boundary emits `@!include-ref` AND is a
   fixed point). Real-tmpdir (mkdtempSync, NO vi.mock).

**Success Definition**:
- `resolve(resolve(x)) === resolve(x)` for a 12-deep linear chain (default maxDepth), a maxDepth=3 +
  5-deep chain, and markers-ON at the boundary — all asserted by the new tests.
- The 3 existing depth tests assert the new elided outputs (`'A '`, `''`, `not.toContain('@l11.md')`).
- At the depth boundary: resolvable-to-file tokens ELIDE (markers off → gone; markers on →
  `<!-- @!include-ref: token -->`); non-resolvable (ENOENT/dir) prose stays verbatim; no recursion; no
  `visited` mutation; no NEW stale-warnings.
- maxDepth=0 uniformly elides the entry's resolvable tokens (entry NOT exempt) → idempotency holds.
- `npx vitest run tests/unit/core/prd-resolve.test.ts` GREEN (new + updated + unaffected); `npm run
  typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Spec compliance (§2.3 L27 — unconditional idempotency MUST).** The PRD states idempotency without
  qualification; the depth gate's literal-survivor leak is a genuine deviation. The fix makes the
  guarantee structural (no resolvable survivor can reach a 2nd pass) rather than dependent on include
  depth staying within the cap.
- **Hash/snapshot/delta consistency.** Resolved output feeds `hashPRD` (§4.1) + delta detection (§4.3).
  A non-idempotent resolution means the hash changes on re-resolution → spurious delta sessions / unstable
  snapshot. This is especially reachable when a user lowers `PRD_INCLUDE_MAX_DEPTH` (a supported §9.7.5
  config) below their actual include depth.
- **Low practical impact under defaults, but the fix is clean.** Default maxDepth=10 needs an 11+ deep
  unique chain (pathological for real distributed PRDs — the project's own spec is depth 1). But the fix
  is a small, well-contained change that makes the unconditional guarantee hold, and it's the
  recommended resolution per the bug report (TEST_RESULTS.md Recommendation: "eliding depth-exceeded
  resolvable tokens … so no resolvable survivor reaches a second pass").
- **Scope discipline.** T2.S1 = the depth-gate elision + helper + JSDoc + the depth tests. S1 (parallel,
  BUG-001) owns the marker-literal collision-proofing. T1.S3 owns changeset docs. No other behavior
  changes (dedup, cycles, diamonds, base invariant, stale-warning, markers all unchanged).

---

## What

### User-visible behavior
None at runtime under realistic inputs (default maxDepth=10 needs an 11+ deep chain). Indirectly: for
pathologically deep specs OR a lowered `PRD_INCLUDE_MAX_DEPTH`, the resolved document is now a true fixed
point (re-resolution is byte-identical), so hashing/delta-detection are stable. At the boundary,
resolvable includes beyond the cap are ELIDED (their content does NOT appear) rather than left as literal
`@token`s.

### Technical requirements (exact contract)

**Edit A — `src/core/session-utils.ts` depth gate** (~:479): replace `if (depth >= maxDepth) { return content; }`
with a call to the new helper:
```ts
if (depth >= maxDepth) {
  // BUG-002: depth-gate ELISION — neutralize resolvable survivors so NONE reach a 2nd pass
  // (preserves the unconditional idempotency MUST: resolve(resolve(x)) === resolve(x), PRD §2.3 L27).
  // For each @token: stat; resolvable-to-FILE → ELIDE (markers off → drop; markers on → collision-proof
  // ref-comment, IDENTICAL to the dedup-elision branch). Non-resolvable (ENOENT/dir) → verbatim.
  // Do NOT recurse (the cap's purpose); do NOT add boundary tokens to visited.
  return neutralizeResolvableTokens(content, baseDir, markers);
}
```

**Edit B — `src/core/session-utils.ts` new helper** (place after `expandIncludesRecursive`):
```ts
/**
 * Depth-gate elision (BUG-002): neutralize resolvable `@token` survivors in a boundary body so none
 * reach a 2nd resolution pass. Mirrors the dedup-elision semantics without recursing.
 *
 * @remarks
 * For each `@token`: `stat()` it; if it resolves to an existing FILE → ELIDE (markers off → drop the
 * token; markers on → emit the collision-proof `<!-- @!include-ref: token -->` ref-comment, IDENTICAL
 * to the dedup-elision branch). If it does NOT resolve (ENOENT or a directory) → leave VERBATIM (a
 * non-resolvable prose mention re-resolves identically, preserving idempotency). Does NOT recurse and
 * does NOT mutate `visited` — the cap's purpose is to bound recursion; this scan only neutralizes
 * survivors. A non-ENOENT `stat` error (e.g. EACCES) THROWS `SessionFileError` (mirrors the main loop).
 * Emits NO stale-include warning (elision = success; verbatim = non-resolving prose, which is silent).
 */
async function neutralizeResolvableTokens(
  content: string,
  baseDir: string,
  markers: boolean
): Promise<string> {
  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx);
    const token = m[1];
    const abs = resolve(baseDir, token);
    let resolves = false;
    try {
      resolves = (await stat(abs)).isFile();
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        resolves = false;
      } else {
        throw new SessionFileError(abs, 'stat include (depth gate)', e as Error);
      }
    }
    out += resolves
      ? (markers ? elisionRefComment(token) : '')   // ELIDE — drop (markers off) / collision-proof ref (on)
      : m[0];                                       // non-resolvable prose → verbatim
    last = idx + m[0].length;
  }
  out += content.slice(last);
  return out;
}
```

**Edit C — [recommended] `elisionRefComment(token)` helper + refactor the dedup-elision branch.** Extract
the marker literal so the dedup-elision branch (~:498) and the gate use the IDENTICAL format (single
source of truth; inherits S1's collision-proofness):
```ts
/** Collision-proof elision reference comment (structurally non-resolvable — S1 technique B). */
function elisionRefComment(token: string): string {
  return `<!-- @!include-ref: ${token} -->`;
}
```
Then the dedup-elision branch (~:498) becomes `out += elisionRefComment(token);` (was the inline literal)
and the gate uses `markers ? elisionRefComment(token) : ''`. (S1 lands first → its `@!include-ref`
literal is already in :498; this refactor moves that literal into the helper. If you prefer not to touch
S1's line, inline the identical `<!-- @!include-ref: ${token} -->` literal in the gate — both copies
MUST match S1's format.)

**Edit D — JSDoc (Mode A)**:
- `expandIncludesRecursive` maxDepth note (~:454-456): state the gate now ELIDES resolvable survivors
  (not literal) → idempotency MUST holds UNCONDITIONALLY (deep unique chains / lowered limits too);
  document the maxDepth=0 entry edge (uniform elision — entry NOT exempt; resolvable tokens elide,
  possibly → empty output; `resolve('') === ''`).
- `resolvePRD` MAX DEPTH bullet (~:574-575): same — gate elides (not literal); unconditional idempotency;
  cite §2.3 L27.

### Success Criteria
- [ ] Depth gate calls `neutralizeResolvableTokens` (no unscanned `return content`).
- [ ] Resolvable-to-file boundary tokens ELIDE (markers off → gone; markers on → `@!include-ref`).
- [ ] Non-resolvable (ENOENT/dir) boundary tokens stay verbatim; EACCES throws `SessionFileError`.
- [ ] Gate does NOT recurse and does NOT mutate `visited`; emits NO stale-warning.
- [ ] `resolve(resolve(x)) === resolve(x)` for the 12-deep default chain, maxDepth=3+5-deep, markers-ON.
- [ ] maxDepth=0 uniformly elides the entry (idempotency holds).
- [ ] 3 existing depth tests updated; 3 new regression tests added; all GREEN.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
current depth-gate code + the dedup-elision branch to mirror (with line numbers), the verbatim
`neutralizeResolvableTokens` helper, the S1 marker-format dependency (`@!include-ref`), the verified
before/after for the 3 existing depth tests, the 3 new regression-test recipes, the maxDepth=0 edge
decision, and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — BUG-002 root cause + reproduction + the elide-recommendation
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/architecture/bug-analysis.md
  section: "BUG-002"
  why: The depth-gate root cause (:479 unscanned return), the 12-deep reproduction, and the
        "eliding depth-exceeded resolvable tokens" recommendation this PRP implements.

# MUST READ — S1's contract (the collision-proof @! marker format T2.S1 depends on)
- file: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T1S1/PRP.md
  why: S1 changes the three marker literals to @! (technique B: ! ∉ [A-Za-z0-9_./-] → RESOLVE_TOKEN
        zero-captures). After S1, the dedup-elision branch emits `<!-- @!include-ref: ${token} -->`.
        T2.S1 emits that EXACT format at the depth gate (inherits collision-proofness).
  critical: T2.S1 begins AFTER S1 lands. The gate's ref-comment MUST match S1's dedup-elision format
        byte-for-byte (use the elisionRefComment helper to enforce this structurally).

# MUST READ — verified implementation + the 3 existing-test before/after + the maxDepth=0 edge (authored here)
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/P1M1T2S1/research/depth-gate-elision-fix.md
  section: "3. The implementation" and "4. The 3 existing depth tests" and "5. The NEW regression tests" and "6. The maxDepth=0 edge"
  why: The verbatim neutralizeResolvableTokens helper, the exact NEW outputs for :190 ('A ')/:208 ('')/
        :220 (not.toContain '@l11.md'), the 3 regression-test recipes, and the uniform-elision decision.
        READ BEFORE IMPLEMENTING.

# PATTERN FILE 1 — the only source file edited
- file: src/core/session-utils.ts
  why: RESOLVE_TOKEN (:422). expandIncludesRecursive depth gate (:479) — the BUG-002 site. The dedup-
        elision branch (:492-501) — the MODEL for neutralizing a resolvable token (markers off → drop;
        markers on → ref-comment; `continue` skips the stale-warning). The stale-warning (:536-541) —
        fires only in the main loop for non-resolving .md tokens; the gate must NOT warn. JSDoc
        maxDepth note (~:454) + resolvePRD MAX DEPTH bullet (~:574). stat/SessionFileError already
        imported.
  pattern: "if (visited.has(abs)) { if (markers) out += '<!-- @include-ref: ${token} -->'; last = idx + m[0].length; continue; }"
  gotcha: The gate scan MUST stat (the boundary token hasn't been visited — it's a unique deep-chain
        file); it cannot use visited.has (that's for the dedup branch). EACCES throws (mirror main loop);
        ENOENT/dir → verbatim. Do NOT recurse; do NOT add to visited.

# PATTERN FILE 2 — the test file (real-tmpdir, NO vi.mock)
- file: tests/unit/core/prd-resolve.test.ts
  why: describe('resolvePRD — max depth') holds the 3 tests to UPDATE (:190 opts.maxDepth=1; :208
        maxDepth=0; :220 default 12-deep). Real-tmpdir (mkdtempSync/tmp + writeFileSync; afterEach rmSync).
        resolvePRD imported from '../../../src/core/session-utils.js'. Add the 3 regression tests here
        (or a sibling describe).
  pattern: "writeFileSync(join(tmp, 'a.md'), 'A @b.md'); … const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 }); expect(out).toBe('A ');"
  gotcha: The NEW outputs have TRAILING SPACES where the elided token was ('A ' from 'A @b.md'; '' from
        '@a.md'). Do NOT "tidy" the trailing space — it's the correct elision artifact.

# VERIFIED FACTS
- fact: "Depth gate :479 `if (depth >= maxDepth) return content;` returns the boundary body UNSCANNED — BUG-002 root cause."
- fact: "Dedup-elision branch :492-501 is the MODEL: markers off → drop token; markers on → ref-comment; `continue` skips stale-warning (elision = success → no warning)."
- fact: "S1 (in-flight) changes the ref-comment to @!include-ref (collision-proof). T2.S1 emits that exact format; recommended: elisionRefComment(token) helper shared by both branches."
- fact: "NEW outputs (traced): :190 maxDepth=1 → 'A ' (trailing space; @b.md elided); :208 maxDepth=0 → '' (entry's @a.md elided); :220 default → levels 1-10 inline, @l11.md ELIDED (not.toContain)."
- fact: "maxDepth=0 closes the gate at the entry (depth 0); uniform elision → entry's resolvable tokens elide (entry NOT exempt); resolve('') === '' → idempotent."
- fact: "Global-flat dedup bounds cycles/diamonds/back-edges but NOT unique linear chains — that's why BUG-002 is reachable for deep chains / lowered limits."
- fact: "All include tests use REAL tmpdir fixtures (mkdtempSync), NOT vi.mock — preserve this (boundary/existence logic is only trustworthy against real files)."
```

### Current Codebase tree (relevant slice)

```bash
src/core/session-utils.ts           # EDIT — depth-gate call + neutralizeResolvableTokens helper + (rec) elisionRefComment helper + JSDoc
tests/unit/core/prd-resolve.test.ts # EDIT — 3 updated depth tests + 3 new regression tests
```

### Desired Codebase tree with files to be edited

```bash
src/core/session-utils.ts           # MODIFIED (gate replacement + 1-2 new helpers + JSDoc; dedup-elision branch optionally refactored to the shared helper)
tests/unit/core/prd-resolve.test.ts # MODIFIED (3 updated tests + 3 new tests; real-tmpdir preserved)
# No other files. No docs subtask (T1.S3 owns changeset docs). S1 owns the marker literals.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the gate scan MUST stat() each token (the boundary token is a UNIQUE deep-chain file, NOT
//   in visited). It CANNOT use visited.has (that's the dedup branch's check). isFile true → elide;
//   ENOENT/dir → verbatim; EACCES/etc → throw SessionFileError (mirror the main loop, don't swallow).

// CRITICAL — do NOT recurse from the gate (the cap's purpose is to bound recursion) and do NOT add
//   boundary tokens to visited (they were never expanded; dedup semantics must be unaffected).

// CRITICAL — emit S1's collision-proof @!include-ref ref-comment at the gate (NOT the old @include-ref).
//   T2.S1 begins after S1 lands. Recommended: elisionRefComment(token) helper shared by the dedup-elision
//   branch + the gate (single source; structurally identical). If inlining, the literal MUST match S1's
//   :498 format byte-for-byte.

// CRITICAL — the NEW depth-test outputs have TRAILING SPACES where the elided token was ('A ' from
//   'A @b.md'; '' from '@a.md'). These are CORRECT elision artifacts — do NOT "tidy" to a single space.

// CRITICAL — maxDepth=0 uniformly elides the ENTRY (depth 0). Do NOT exempt the entry (exempting re-opens
//   BUG-002 for maxDepth=0). resolve('') === '' → idempotent. Document this edge in JSDoc + the :208 test.

// CRITICAL — preserve the stale-warning contract: the gate emits NO warning (elision = success; verbatim =
//   non-resolving prose, silent). The stale-warning at :536-541 fires ONLY in the main loop for
//   non-resolving .md tokens. Do NOT add any warning in neutralizeResolvableTokens.

// GOTCHA — reuse the RESOLVE_TOKEN scan loop pattern (content.matchAll(RESOLVE_TOKEN) + slice gap/tail);
//   do NOT duplicate the regex or invent a new token-matching mechanism.

// GOTCHA — TDD order: RED first (3 new regression tests + 3 updated existing tests ALL FAIL against
//   current source), then GREEN (implement the gate elision → all pass). Do not implement before the
//   failing tests exist.

// GOTCHA — S1 (parallel) edits the marker LITERALS (:498, :545) in the SAME function. T2.S1 edits the
//   depth GATE (:479) + adds helpers. The orchestrator sequences S1 → T2.S1. If you extract
//   elisionRefComment and refactor S1's :498 literal into a helper call, that's a safe one-line refactor
//   of an already-landed literal — coordinate via sequencing, don't conflict.

// GOTCHA — do NOT touch the dedup logic, cycle/diamond handling, base invariant, stale-warning, or
//   marker expansion wrap (:545). Only the depth gate + the new helper (+ optional shared elision helper).

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — vitest 100% coverage on src: the new helper's branches (resolves true/false; markers on/off;
//   ENOENT vs EACCES) must each be hit by the tests. The 3 regression + 3 updated tests cover them:
//   resolves-true (the chains), resolves-false (add a non-resolvable prose token to a boundary body, or
//   rely on the verbatim-prose-survives behavior), markers-on (regression c), EACCES (optional — the
//   main loop's EACCES test already covers SessionFileError; mirror it if coverage demands).
```

---

## Implementation Blueprint

### Data models and structure
None new — the helper reuses `RESOLVE_TOKEN`, `stat`, `resolve`, `SessionFileError`, and (optionally) the
`elisionRefComment` helper. No types/constants.

### Implementation Tasks (TDD: failing tests FIRST → implement → green)

```yaml
Task 1: EDIT tests/unit/core/prd-resolve.test.ts — UPDATE the 3 existing depth tests (RED)
  - :190 'stops expanding at opts.maxDepth': title → 'elides resolvable survivors at opts.maxDepth
        (idempotency at the boundary)'; assertion 'A @b.md' → 'A ' (trailing space); ADD
        expect(out).not.toContain('@b.md'); keep toContain('A ')/not.toContain('B ')/not.toContain('C').
        Rewrite the comment (elided, not literal).
  - :208 'opts.maxDepth = 0': title → "elides the entry's resolvable tokens at opts.maxDepth = 0
        (uniform-elision edge)"; assertion '@a.md' → ''; ADD an idempotency check (write '' → resolvePRD
        → ''). Document the maxDepth=0 entry edge in the comment.
  - :220 'default depth bound': toContain('@l11.md') → not.toContain('@l11.md'); keep toContain('L1 '/'L10 ')/
        not.toContain('L11 ')/not.toContain('LEAF'). Rewrite the comment (@l11.md elided at the depth-10
        boundary).
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts → the 3 UPDATED tests FAIL (current source
        still returns literal survivors).

Task 2: EDIT tests/unit/core/prd-resolve.test.ts — ADD 3 new regression tests (RED)
  - (a) 12-deep linear chain, default maxDepth — fixed point: build l1..l12 (l12='LEAF'; lN=`L${i} @l${i+1}.md`);
        main='@l1.md'. o1=resolvePRD(main); write pass2=o1; o2=resolvePRD(pass2); expect(o2).toBe(o1).
  - (b) opts.maxDepth=3 + 5-deep chain — fixed point: 5-deep chain; o1=resolvePRD(main,{maxDepth:3});
        write pass2; o2=resolvePRD(pass2,{maxDepth:3}); expect(o2).toBe(o1).
  - (c) markers ON at the boundary — ref-comment + fixed point: a chain that hits the gate with
        {markers:true, maxDepth:N}; o1=resolvePRD(...); expect(o1).toContain('<!-- @!include-ref:');
        write pass2; o2=resolvePRD(pass2,{markers:true,maxDepth:N}); expect(o2).toBe(o1).
  - RUN: the 3 NEW tests FAIL too (current source: literal survivor expands on pass 2 / no @!include-ref).
  - PLACEMENT: in describe('resolvePRD — max depth') or a sibling describe('resolvePRD — depth-gate
        idempotency (BUG-002)'). Real-tmpdir (mkdtempSync; NO vi.mock).
  - NAMING: it('resolve(resolve(x)) === resolve(x) for a 12-deep linear chain (default maxDepth)'),
        it('resolve(resolve(x)) === resolve(x) with a lowered opts.maxDepth'), it('markers ON at the
        depth boundary emit a collision-proof ref-comment and stay a fixed point').

Task 3: EDIT src/core/session-utils.ts — add elisionRefComment helper (recommended) + refactor dedup-elision branch
  - ADD function elisionRefComment(token): string { return `<!-- @!include-ref: ${token} -->`; } (S1's
        collision-proof format).
  - REFACTOR the dedup-elision branch (~:498) to use it: `out += elisionRefComment(token);` (was the
        inline literal). [If avoiding S1's line, skip this refactor and inline the identical literal in
        the gate instead — both copies must match S1's @! format.]
  - (This is a safe one-line refactor of S1's already-landed literal; the orchestrator sequences S1 first.)

Task 4: EDIT src/core/session-utils.ts — replace the depth gate + add neutralizeResolvableTokens (GREEN)
  - :479 `if (depth >= maxDepth) { return content; }` → `if (depth >= maxDepth) { return
        neutralizeResolvableTokens(content, baseDir, markers); }` (with the BUG-002 comment).
  - ADD neutralizeResolvableTokens after expandIncludesRecursive (verbatim from Edit B; uses stat → isFile?
        elisionRefComment/'' : m[0]; ENOENT→verbatim; EACCES→throw SessionFileError).
  - DO NOT: recurse from the gate, mutate visited, add a stale-warning, touch the dedup/cycle/diamond/
        base-invariant/marker-wrap logic.
  - EXPECTED: the 3 updated + 3 new tests now PASS (no resolvable survivor reaches pass 2).

Task 5: EDIT src/core/session-utils.ts — JSDoc (Mode A)
  - expandIncludesRecursive maxDepth note (~:454): gate now ELIDES resolvable survivors (not literal) →
        idempotency UNCONDITIONAL; document the maxDepth=0 entry edge (uniform elision).
  - resolvePRD MAX DEPTH bullet (~:574): same; cite §2.3 L27.

Task 6: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-resolve.test.ts → ALL GREEN (3 updated + 3 new + unaffected).
  - RUN (regression): npx vitest run tests/unit/core/prd-markers.test.ts tests/unit/core/prd-includes.test.ts
        → GREEN (dedup/markers/single-level unaffected).
  - EXPECTED: all clean/green. If a regression test still fails, confirm the gate now calls
        neutralizeResolvableTokens (not `return content`) and the helper elides (isFile true) rather than
        recursing. If markers-ON test fails on the ref-comment format, confirm it matches S1's @!include-ref.
```

### Implementation Patterns & Key Details

```ts
// ---- the depth-gate replacement (~:479) ----
if (depth >= maxDepth) {
  return neutralizeResolvableTokens(content, baseDir, markers);   // BUG-002: elide resolvable survivors
}

// ---- the helper (after expandIncludesRecursive) ----
async function neutralizeResolvableTokens(content: string, baseDir: string, markers: boolean): Promise<string> {
  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = ''; let last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx);
    const token = m[1];
    const abs = resolve(baseDir, token);
    let resolves = false;
    try { resolves = (await stat(abs)).isFile(); }
    catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') { resolves = false; }
      else { throw new SessionFileError(abs, 'stat include (depth gate)', e as Error); }
    }
    out += resolves ? (markers ? elisionRefComment(token) : '') : m[0];
    last = idx + m[0].length;
  }
  out += content.slice(last);
  return out;
}

// ---- the shared marker helper (recommended; S1's collision-proof format) ----
function elisionRefComment(token: string): string {
  return `<!-- @!include-ref: ${token} -->`;
}

// ---- the 3 updated depth assertions (fixtures UNCHANGED) ----
// :190 maxDepth=1
expect(out).toBe('A ');               // was 'A @b.md' (trailing space; @b.md elided)
expect(out).not.toContain('@b.md');   // proves elision, not literal
// :208 maxDepth=0
expect(out).toBe('');                 // was '@a.md' (entry's @a.md elided — uniform-elision edge)
// :220 default 12-deep
expect(out).not.toContain('@l11.md'); // was .toContain (elided at the depth-10 boundary)

// ---- the 3 new regression tests (real tmpdir) ----
// (a) 12-deep default fixed point
const o1 = await resolvePRD(join(tmp, 'main.md'));
writeFileSync(join(tmp, 'pass2.md'), o1);
const o2 = await resolvePRD(join(tmp, 'pass2.md'));
expect(o2).toBe(o1);
// (c) markers ON at the boundary
const o1m = await resolvePRD(join(tmp, 'main.md'), { markers: true, maxDepth: /*N to hit the gate*/ });
expect(o1m).toContain('<!-- @!include-ref:');
writeFileSync(join(tmp, 'pass2m.md'), o1m);
const o2m = await resolvePRD(join(tmp, 'pass2m.md'), { markers: true, maxDepth: /*same N*/ });
expect(o2m).toBe(o1m);
```

### Integration Points

```yaml
DEPENDS ON (must be LANDED before T2.S1 is correct):
  - P1.M1.T1.S1 (BUG-001 collision-proof markers): the dedup-elision branch emits @!include-ref post-S1.
        T2.S1's gate emits that EXACT format (via the shared elisionRefComment helper or an identical
        literal). The orchestrator sequences S1 → T2.S1.

NO OTHER SOURCE CHANGES: the dedup logic, cycle/diamond handling, base invariant, stale-warning, and
  marker expansion wrap are UNCHANGED. Only the depth gate + the new helper (+ optional shared marker
  helper) change. resolvePRD's signature/behavior for within-cap inputs is UNCHANGED.

DOWNSTREAM (separate subtask):
  - P1.M1.T1.S3 (changeset docs): README/overview docs for the §2.3 idempotency/marker changeset. T2.S1
        is the code+test fix; T1.S3 is the docs sweep.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint && npm run format:check   # clean
# Expected: clean. The helper + gate call are straightforward TS; typecheck catches any signature drift.
```

### Level 2: Unit Tests (the TDD gate)

```bash
# RED phase (Tasks 1-2, before the fix): the 3 updated + 3 new depth tests FAIL.
# GREEN phase (after Task 4): ALL pass.
npx vitest run tests/unit/core/prd-resolve.test.ts
# Expected (final): ALL GREEN — 3 updated depth tests + 3 new regression tests + the unaffected tests.
#   If a regression test still fails, confirm the gate calls neutralizeResolvableTokens (not return content)
#   and the helper elides (isFile) rather than recursing. If the markers-ON test fails on the ref format,
#   confirm it matches S1's @!include-ref.
# Regression — dedup/markers/single-level unaffected:
npx vitest run tests/unit/core/prd-markers.test.ts tests/unit/core/prd-includes.test.ts
# Expected: GREEN (only the depth gate changed; dedup/cycle/diamond/markers/single-level untouched).
```

### Level 3: Integration Testing (the idempotency proof)

```bash
# Smoke: the 12-deep linear chain is byte-idempotent end-to-end (real tmpdir).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const tmp = mkdtempSync(join(tmpdir(), 'bug002-'));
for (let i = 1; i <= 12; i++) writeFileSync(join(tmp, 'l'+i+'.md'), i === 12 ? 'LEAF' : 'L'+i+' @l'+(i+1)+'.md');
writeFileSync(join(tmp, 'main.md'), '@l1.md');
import('./src/core/session-utils.ts').then(async m => {
  const o1 = await m.resolvePRD(join(tmp, 'main.md'));
  writeFileSync(join(tmp, 'pass2.md'), o1);
  const o2 = await m.resolvePRD(join(tmp, 'pass2.md'));
  console.log('idempotent:', o1 === o2, '| @l11.md survivor:', o1.includes('@l11.md'));
  rmSync(tmp, { recursive: true, force: true });
});
"
# Expected: idempotent: true | @l11.md survivor: false  (elided at the depth-10 boundary; no literal survivor).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Depth gate now ELIDES resolvable survivors (not literal) → resolve(resolve(x))===resolve(x) UNCONDITIONAL.
#   - Elision mirrors the dedup-elision branch (markers off → drop; markers on → @!include-ref collision-proof ref).
#   - Non-resolvable prose (ENOENT/dir) stays verbatim at the boundary (re-resolves identically).
#   - Gate does NOT recurse / mutate visited / emit warnings; EACCES throws (mirrors main loop).
#   - maxDepth=0 uniformly elides the entry (entry NOT exempt) → idempotency holds (resolve('')==='').
#   - Inherits S1's collision-proof @! marker format (recommended via the shared elisionRefComment helper).
#   - Dedup/cycle/diamond/base-invariant/markers/single-level behavior UNCHANGED.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npx vitest run tests/unit/core/prd-resolve.test.ts` GREEN (3 updated + 3 new + unaffected).
- [ ] `npx vitest run tests/unit/core/prd-markers.test.ts tests/unit/core/prd-includes.test.ts` GREEN (regression).

### Feature Validation
- [ ] Depth gate calls `neutralizeResolvableTokens` (no unscanned `return content`).
- [ ] Resolvable boundary tokens ELIDE (markers off → gone; markers on → `@!include-ref`); non-resolvable verbatim.
- [ ] `resolve(resolve(x)) === resolve(x)` for the 12-deep default chain, maxDepth=3+5-deep, markers-ON.
- [ ] maxDepth=0 uniformly elides the entry (idempotency holds).
- [ ] Gate: no recursion, no visited mutation, no new stale-warnings, EACCES throws.

### Code Quality Validation
- [ ] Only `src/core/session-utils.ts` (gate + helper + optional shared marker helper + JSDoc) + `tests/unit/core/prd-resolve.test.ts` (3 updated + 3 new) modified.
- [ ] Dedup/cycle/diamond/base-invariant/stale-warning/marker-wrap logic UNCHANGED.
- [ ] Gate reuses RESOLVE_TOKEN scan loop (no regex duplication); mirrors dedup-elision semantics.
- [ ] Emits S1's collision-proof `@!include-ref` at the gate (identical to the dedup-elision branch).
- [ ] TDD order followed (RED: 6 failing tests; GREEN: implement → all pass).

### Documentation & Deployment
- [ ] JSDoc on expandIncludesRecursive maxDepth note + resolvePRD MAX DEPTH bullet: gate ELIDES; idempotency unconditional; maxDepth=0 edge documented.
- [ ] Commit message notes: BUG-002 fixed (depth-gate elision); idempotency now unconditional; inherits S1's @! marker; dedup/cycle/diamond unchanged; T1.S3 = changeset docs.

---

## Anti-Patterns to Avoid

- ❌ Don't leave the depth gate as `return content` (unscanned) — that IS BUG-002. Replace with the
      `neutralizeResolvableTokens` call.
- ❌ Don't use `visited.has` in the gate — the boundary token is a UNIQUE deep-chain file, never visited.
      You MUST `stat()` to determine resolvability.
- ❌ Don't recurse from the gate or add boundary tokens to `visited` — the cap bounds recursion; mutating
      visited would corrupt dedup semantics for the rest of the resolution.
- ❌ Don't emit the OLD `@include-ref` (no `@!`) — S1 lands collision-proof `@!include-ref`; the gate must
      match it byte-for-byte (use the shared `elisionRefComment` helper, or inline the identical literal).
- ❌ Don't swallow EACCES/etc. as "non-resolvable" — mirror the main loop: throw `SessionFileError`. Only
      ENOENT + directory → verbatim.
- ❌ Don't add a stale-include warning in the gate — elision = success (no warning); verbatim =
      non-resolving prose (silent). The stale-warning fires only in the main loop.
- ❌ Don't "tidy" the TRAILING SPACE in the updated depth-test outputs (`'A '` from `'A @b.md'`; `''` from
      `'@a.md'`) — the elided token leaves the surrounding whitespace; those are correct.
- ❌ Don't exempt the entry from maxDepth=0 elision — uniform elision (entry included) preserves the
      unconditional guarantee; exempting re-opens BUG-002 for that case.
- ❌ Don't touch the dedup/cycle/diamond/base-invariant/stale-warning/marker-wrap logic — only the depth
      gate + the new helper (+ optional shared marker helper).
- ❌ Don't skip the TDD RED phase — write the 3 new + 3 updated failing tests FIRST, then implement.
- ❌ Don't run the full `npm run test:run` as the gate — S1's prd-markers.test.ts may be in flux. Gate on
      prd-resolve.test.ts green + the prd-markers/prd-includes regression.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: The fix is a well-contained, single-site change (the depth gate) plus a small helper that
mirrors an existing, proven branch (the dedup-elision path at :492-501). The root cause is precisely
identified (unscanned `return content` at :479), the fix is exactly specified (stat → isFile? elide :
verbatim; no recurse; no visited; EACCES throws), and the S1 marker-format dependency is explicit
(`@!include-ref`, inherited via the shared helper). Every NEW/updated test output is traced through the
proposed implementation (`'A '` / `''` / `not @l11.md`), the 3 regression-test recipes are concrete, and
the maxDepth=0 edge is decided (uniform elision) with its idempotency proven. The TDD RED→GREEN order is
self-verifying. The parallel-execution boundary with S1 (same function, different lines; S1 lands first;
the optional `elisionRefComment` refactor is a safe one-line change to S1's already-landed literal) is
crisp. No external/runtime unknowns — the Level-3 smoke (12-deep chain idempotent, no @l11.md survivor)
is deterministic.