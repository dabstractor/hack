# Research — P1.M1.T2.S1: Elide resolvable survivors at the depth gate (BUG-002, TDD)

## 1. The bug (BUG-002) + the fix

`expandIncludesRecursive` (src/core/session-utils.ts, def ~:471) has a depth gate at :479:
```ts
if (depth >= maxDepth) { return content; }   // returns the boundary body UNSCANNED
```
A boundary file's resolvable `@token`s (files that DO exist) survive as **literal resolvable survivors**.
On a 2nd resolution pass they sit at depth 0 and EXPAND → `resolve(resolve(x)) !== resolve(x)`,
violating PRD §2.3 L27's UNCONDITIONAL idempotency MUST. Default maxDepth=10 (getPrdIncludeMaxDepth)
needs an 11+ deep LINEAR chain (unique files — global-flat dedup bounds cycles/diamonds/back-edges
ONLY, not unique linear chains), or a user-lowered `PRD_INCLUDE_MAX_DEPTH` (§9.7.5).

**Fix**: replace the unscanned `return content` with a NEUTRALIZE-SCAN that mirrors the existing
elision branch (:492-501): for each `@token` at the boundary, `stat()` it; if it resolves to an
existing FILE → ELIDE (markers off → drop token / emit nothing; markers on → emit the collision-proof
`<!-- @!include-ref: ${token} -->` ref-comment IDENTICAL to the dedup-elision branch); if it does NOT
resolve (ENOENT / directory) → leave VERBATIM (non-resolvable prose re-resolves identically → still
idempotent). **Do NOT recurse** (the cap's purpose); **do NOT add boundary tokens to visited**. Reuse
the `RESOLVE_TOKEN` scan loop pattern (do NOT duplicate the regex).

## 2. S1 dependency — the collision-proof marker format (BUG-001, in-flight, CONTRACT)

S1 (P1.M1.T1.S1) makes the three marker strings structurally non-resolvable via technique B (`@!` after
`@` — `!` ∉ `[A-Za-z0-9_./-]` → the token group can't start → RESOLVE_TOKEN zero-captures). After S1
lands, the dedup-elision branch emits `<!-- @!include-ref: ${token} -->`. **T2.S1 emits that EXACT
format at the depth gate** so the gate inherits collision-proofness automatically. (The contract's prose
wrote `@include-ref` but the intent — per S1's PRP — is the collision-proof `@!include-ref`; T2.S1
matches whatever the dedup-elision branch emits post-S1.)

**DRY recommendation**: extract a tiny module-private helper `elisionRefComment(token): string` (returns
`<!-- @!include-ref: ${token} -->`) and use it in BOTH the dedup-elision branch AND the new depth-gate
scan, so the two sites are PROVABLY identical (single source for the marker format). S1 lands first →
T2.S1 refactors S1's one literal into the helper call (safe, minimal). If the implementer prefers not to
touch S1's line, inlining the identical literal in the gate is acceptable (both copies must match S1's
format). Either way the OUTPUT is `@!include-ref` (markers on) / nothing (markers off).

## 3. The implementation (verified against the live source)

**Depth-gate replacement** (~:479):
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

**New helper** (placed after `expandIncludesRecursive`):
```ts
async function neutralizeResolvableTokens(content: string, baseDir: string, markers: boolean): Promise<string> {
  const matches = [...content.matchAll(RESOLVE_TOKEN)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    const idx = m.index!;
    out += content.slice(last, idx);              // gap before token (verbatim)
    const token = m[1];
    const abs = resolve(baseDir, token);
    let resolves = false;
    try {
      resolves = (await stat(abs)).isFile();      // existing FILE → resolvable
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') { resolves = false; }            // missing → non-resolvable → verbatim
      else { throw new SessionFileError(abs, 'stat include (depth gate)', e as Error); }  // EACCES etc → throw (mirrors main loop)
    }
    out += resolves
      ? (markers ? elisionRefComment(token) : '')  // ELIDE — drop (markers off) or collision-proof ref (on)
      : m[0];                                      // non-resolvable prose → verbatim (re-resolves identically)
    last = idx + m[0].length;
  }
  out += content.slice(last);                      // tail
  return out;
}
```
- **Stale-warning contract preserved**: the gate emits NO warning (elision = success; verbatim =
  non-resolving prose, which is silent). No NEW warnings introduced. (The stale-warning at :536-541
  fires only in the main loop for non-resolving `.md` tokens; the gate doesn't warn.)
- **EACCES/etc.**: mirror the main loop — throw `SessionFileError` (don't silently treat as
  non-resolvable). ENOENT + directory → verbatim.

## 4. The 3 existing depth tests — exact before/after (verified current code)

### `tests/unit/core/prd-resolve.test.ts` — `describe('resolvePRD — max depth')`

**Test :190** `it('stops expanding at opts.maxDepth (deeper tokens stay literal)')` — fixture
c='C', b='B @c.md', a='A @b.md', main='@a.md', `maxDepth:1`.
- OLD: `expect(out).toBe('A @b.md');` (+ `toContain('A ')`, `not.toContain('B ')`, `not.toContain('C')`).
- NEW: at the depth-1 boundary, a's body 'A @b.md' is neutralized → @b.md (exists) ELIDED → `'A '`
  (trailing space). `expect(out).toBe('A ');` + ADD `expect(out).not.toContain('@b.md');` (proves
  elision not literal). Keep `toContain('A ')`, `not.toContain('B ')`, `not.toContain('C')`.
- Title: "(deeper tokens stay literal)" is now WRONG → e.g. `it('elides resolvable survivors at opts.maxDepth (idempotency at the boundary)')`. Rewrite the comment.

**Test :208** `it('stops expanding at opts.maxDepth = 0 (entry returned verbatim)')` — fixture
a='A', main='@a.md', `maxDepth:0`.
- OLD: `expect(out).toBe('@a.md');`.
- NEW: maxDepth=0 → gate closes at the entry (depth 0); uniform elision → entry's '@a.md' (exists)
  ELIDED → `''`. `expect(out).toBe('');`. (Idempotency holds: resolve('') === ''.) ADD an idempotency
  assertion: write '' to a file, resolvePRD → ''.
- Title: "(entry returned verbatim)" is WRONG → e.g. `it('elides the entry\'s resolvable tokens at opts.maxDepth = 0 (uniform-elision edge)')`. Document the maxDepth=0 entry edge in the comment.

**Test :220** `it('stops expanding at the default depth bound (PRD_INCLUDE_MAX_DEPTH)')` — 12-deep
chain, default maxDepth=10.
- OLD: `toContain('L1 ')`, `toContain('L10 ')`, `toContain('@l11.md')` (literal), `not.toContain('L11 ')`,
  `not.toContain('LEAF')`.
- NEW: at the depth-10 boundary, l10's body 'L10 @l11.md' is neutralized → @l11.md (exists) ELIDED.
  `expect(out).not.toContain('@l11.md');` (was `.toContain`). Keep `toContain('L1 '/'L10 ')`,
  `not.toContain('L11 ')`, `not.toContain('LEAF')`. Rewrite the "@l11.md literal" comment → "elided".

## 5. The NEW regression tests (TDD — failing FIRST)

Append to `describe('resolvePRD — max depth')` (or a sibling `describe('resolvePRD — depth-gate idempotency (BUG-002)')`):

**(a) 12-deep linear chain, default maxDepth — fixed point.**
Fixture: `for i in 1..12 l{i}.md = (i==12?'LEAF':\`L${i} @l${i+1}.md\`); main='@l1.md'`.
`o1 = await resolvePRD(main); writeFileSync(pass2, o1); o2 = await resolvePRD(pass2); expect(o2).toBe(o1);`
FAILS before the fix (literal @l11.md expands on pass 2). PASSES after (elided → no survivor).

**(b) opts.maxDepth=3 with a 5-deep chain — fixed point (lowered-limit scenario).**
Fixture: 5-deep chain; `resolvePRD(main, {maxDepth:3})`. Write to pass2; `resolvePRD(pass2, {maxDepth:3})`.
`expect(o2).toBe(o1);`. FAILS before (literal survivor at depth-3 boundary). PASSES after.

**(c) markers ON at the boundary — emits the collision-proof ref-comment AND is a fixed point.**
Fixture: a deep chain (e.g. the 12-deep or a small one with maxDepth lowered). `o1 = resolvePRD(main,
{markers:true, maxDepth:N})`. Assert `o1` CONTAINS `<!-- @!include-ref:` (the elided boundary ref) AND
write o1→pass2, `o2 = resolvePRD(pass2, {markers:true, maxDepth:N})`, `expect(o2).toBe(o1)`. FAILS before
(literal survivor). PASSES after (elided ref is collision-proof → fixed point).

**RED phase** = add (a)(b)(c) + update the 3 existing tests (:190/:208/:220) → ALL FAIL against current
source. **GREEN** = implement the depth-gate elision → ALL PASS.

## 6. The maxDepth=0 edge — DECISION: uniform elision (entry included)

The contract's recommended choice: **uniform elision** (the entry is NOT exempt) — because exempting the
entry re-opens BUG-002 for the maxDepth=0 case (an entry with resolvable @tokens would survive literal).
Under uniform elision, maxDepth=0 neutralizes the entry's resolvable tokens (possibly → empty output),
and idempotency holds (`resolve('') === ''`; `resolve(neutralized) === neutralized`). Document this in
the JSDoc + the :208 test comment. (The implementation naturally does this — the gate fires at depth 0
for the entry and runs `neutralizeResolvableTokens` on it.)

## 7. JSDoc updates (Mode A)

- **expandIncludesRecursive** (~:454-456, the "maxDepth is DEFENSE-IN-DEPTH only" note): state the gate
  now ELIDES resolvable survivors (not literal) so the idempotency MUST holds UNCONDITIONALLY (even for
  deep unique chains / lowered limits). Document the maxDepth=0 entry edge (uniform elision).
- **resolvePRD MAX DEPTH bullet** (~:574-575): same — the gate elides (not literal); idempotency is
  unconditional; cite §2.3 L27.

## 8. Parallel-execution / file-disjoint check

- **vs S1 (in-flight, BUG-001 collision-proof markers):** S1 edits the three marker LITERALS in
  `expandIncludesRecursive` (:498, :545) + prd-markers.test.ts. T2.S1 edits the depth GATE (:479) + adds
  the `neutralizeResolvableTokens` helper + prd-resolve.test.ts. **Different lines within the same
  function** — the orchestrator sequences S1 first; T2.S1 builds on S1's landed `@!` format. If T2.S1
  extracts `elisionRefComment` and refactors S1's :498 literal into a helper call, that's a safe one-line
  refactor of an already-landed literal. (The depth-gate site :479 is DISJOINT from S1's :498/:545.)
- **vs T1.S2 / T2.S1 (the dedup test-rewrite track, different bugfix session):** that's
  `plan/014_347986b2effd/P1M1T2S1` (no `bugfix/` segment) — a DIFFERENT session from this
  `bugfix/001_0bc1da79f558`. No overlap.
- **No source conflict**: T2.S1's depth-gate + helper are additive within `expandIncludesRecursive`'s
  neighborhood; S1's marker-literal edits are on different lines. Coordinate via the orchestrator's
  sequencing (S1 → T2.S1).

## 9. Decisions locked

- **Depth-gate elision** via a `neutralizeResolvableTokens` scan (stat → isFile? elide : verbatim; no
  recurse; no visited mutation; EACCES throws, ENOENT/dir verbatim).
- **Emit S1's collision-proof `@!include-ref` ref-comment** at the gate (identical to the dedup-elision
  branch); recommend a shared `elisionRefComment(token)` helper (DRY), inline-literal acceptable.
- **Uniform elision** for maxDepth=0 (entry included) — preserves the unconditional guarantee.
- **TDD**: RED = 3 new regression tests (a/b/c) + 3 updated existing tests (:190/:208/:220); GREEN =
  implement.
- **JSDoc** on expandIncludesRecursive's maxDepth note + resolvePRD's MAX DEPTH bullet (Mode A).
- **No stale-warning change** (gate emits no warning; elision = success, verbatim = silent prose).
- **Real-tmpdir tests** (mkdtempSync, NO vi.mock node:fs) — mirror prd-resolve.test.ts.