# Research — P1.M1.T2.S1: Add the stale-`.md` stderr warning to `neutralizeResolvableTokens` + correct 2 JSDoc spots

## 1. The bug (BUG-002, this session 002)

PRD §2.3 states UNCONDITIONALLY: "A `.md` token that fails to resolve (stale include) MUST emit a stderr
warning." The main recursive loop warns correctly (`expandIncludesRecursive` L550-554), but the **depth-
gate path does not**. When `depth >= maxDepth`, `expandIncludesRecursive` delegates to
`neutralizeResolvableTokens` (src/core/session-utils.ts), which by design "Emits NO stale-include
warning." So a non-resolving `.md` token at the gate survives verbatim with ZERO warning — defeating the
typo-detection purpose for deeply-nested specs (reachable at default maxDepth=10 via a 10-deep chain
whose deepest member references a missing `.md`, or trivially via `opts.maxDepth=1`).

**Fix**: in `neutralizeResolvableTokens`'s non-resolving branch, when `!resolves && token.endsWith('.md')`,
emit EXACTLY ONE `console.warn` with the SAME message as the main loop. Keep `out += m[0]` (verbatim).
Plus correct the two JSDoc spots that now claim "no warning."

## 2. Verified source state

### `neutralizeResolvableTokens` (src/core/session-utils.ts) — the fix site
The non-resolving arm is the ternary `out += resolves ? (markers ? elisionRefComment(token) : '') : m[0];`.
`token`, `abs = resolve(baseDir, token)`, and `resolves` (true iff an existing FILE) are ALL already
computed. So the warn needs only `!resolves && token.endsWith('.md')` + the identical message. The fix
is a 4-line insertion before the ternary's verbatim arm.

### The main-loop warn (L550-554) — the message to mirror EXACTLY
```ts
if (replacement === undefined && token.endsWith('.md')) {
  console.warn(
    `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
  );
}
```
**DRY recommendation**: extract `emitStaleIncludeWarning(token, abs)` and use it in BOTH the main loop
(L550-554) AND `neutralizeResolvableTokens`. Guarantees byte-identical format (no drift). Tiny, safe
refactor of the already-landed main-loop literal. (Inline the identical literal is acceptable if the
implementer prefers minimal touch — both copies MUST match L553 byte-for-byte.)

### No double-warn risk (verified)
A gate token only ever passes through `neutralizeResolvableTokens` — the gate `return`s its result
early, so the token NEVER reaches the main loop's warn. Warning once in the gate is correct; the same
token cannot warn twice in one pass.

### Output bytes UNCHANGED → idempotency preserved
The warn is a SIDE EFFECT (stderr); the verbatim survivor (`m[0]`) is still emitted to `out`. Re-
resolution re-warns once per pass (spec-correct — the stale token is still stale on pass 2) but the
OUTPUT bytes are identical → `resolve(resolve(x)) === resolve(x)` still holds. The BUG-002 idempotency
fix (bugfix/001, landed) is unaffected.

## 3. The two JSDoc spots to correct

### Spot 1 — `neutralizeResolvableTokens` JSDoc (L593)
- BEFORE: "Emits NO stale-include warning (elision = success; verbatim = non-resolving prose, which is silent)."
- AFTER: "A non-resolvable `.md` token (ENOENT or directory) at the gate emits exactly one **stderr**
  warning via `console.warn` (PRD §2.3 MUST — same message as the main loop). Elided (resolvable) tokens,
  non-`.md` survivors, and successfully-resolved tokens are silent."

### Spot 2 — `resolvePRD` STALE-INCLUDE WARNING bullet (L678-680)
- BEFORE: "Non-`.md` tokens, elided references (cycles/diamonds/back-edges — elision is a SUCCESSFUL
  resolution), **depth-exceeded tokens**, and successfully-resolved tokens emit NO warning (PRD §2.3)."
- AFTER: REMOVE "depth-exceeded tokens" from the silent list — a stale `.md` at the maxDepth gate now
  warns (the gate scan performs the same stale-`.md` check as the main loop). New text: "Non-`.md`
  tokens, elided references (cycles/diamonds/back-edges — elision is a SUCCESSFUL resolution), and
  successfully-resolved tokens emit NO warning. A stale `.md` at the maxDepth gate ALSO emits exactly
  one warning (the depth-gate scan runs the same stale-`.md` check) — only elided/resolved/non-`.md`
  tokens are silent everywhere (PRD §2.3)."

## 4. TDD — the failing test FIRST (prd-markers.test.ts)

Mirror the file's existing stale-warning pattern: REAL tmpdir (mkdtempSync), `vi.spyOn(console,'warn').mockImplementation(() => {})`,
`expect(warn).toHaveBeenCalledTimes(1)`, `expect(String(warn.mock.calls[0][0])).toContain(...)`.

**(a) RED — stale `.md` at the gate warns exactly once.**
Fixture: g.md='G @missing.md END', main.md='@g.md', `resolvePRD(main, {maxDepth:1})`.
- Trace: main (depth 0) < 1 → expand @g.md → read g.md → recurse at depth 1 → depth 1 >= 1 → GATE →
  `neutralizeResolvableTokens('G @missing.md END')`: @missing.md → stat ENOENT → resolves=false →
  `!resolves && .md` → WARN once → out += '@missing.md' → return 'G @missing.md END'.
- Assert: `warn.toHaveBeenCalledTimes(1)`; `String(warn.mock.calls[0][0]).toContain('missing.md')`;
  `out === 'G @missing.md END'`.
- FAILS before the fix (gate emits 0 warns). PASSES after.

**(b) Negative — non-`.md` at the gate is silent.**
Fixture: g.md='G @missing.txt END', main.md='@g.md', maxDepth=1. @missing.txt → ENOENT → !resolves but
NOT .md → NO warn. Assert `warn.not.toHaveBeenCalled()`. (Passes before AND after — locks the .md-only rule.)

**(c) Negative — resolvable token at the gate is elided + silent.**
Fixture: g.md='G @h.md END', h.md='H', main.md='@g.md', maxDepth=1. @h.md → stat isFile → resolves=true
→ ELIDE (markers off → '') → out='G  END' (double space). Assert `warn.not.toHaveBeenCalled()` AND
`out === 'G  END'` (elided, not literal — cross-checks the BUG-002 idempotency fix). (Passes before+after.)

**(d) maxDepth=0 entry edge — stale `.md` in the ENTRY warns (spec-correct per the unconditional MUST).**
Fixture: main.md='@missing.md', `resolvePRD(main, {maxDepth:0})`. Gate fires at the entry (depth 0);
@missing.md → ENOENT → !resolves && .md → WARN once → out='@missing.md'. Assert `warn.toHaveBeenCalledTimes(1)`
+ `out === '@missing.md'`. (FAILS before; PASSES after. Confirms uniform treatment — the entry is NOT exempt.)

**Placement**: a focused `describe('resolvePRD — stale .md warning at the maxDepth gate (BUG-002)')`
inside the file's existing `describe('resolvePRD — markers, stale warnings, idempotency')` style. REAL
tmpdir (mkdtempSync/writeFileSync/rmSync); NO vi.mock node:fs.

## 5. Why the existing tests stay green (no regression)

- The existing "emits a stderr warning for a stale .md token" test (prd-markers.test.ts L122) uses
  DEFAULT maxDepth (the entry's @missing.md is processed by the MAIN LOOP at depth 0 < 10, not the gate).
  The main loop already warns — unchanged. ✓
- The BUG-002 idempotency tests (bugfix/001, prd-resolve.test.ts) assert OUTPUT bytes / fixed-point;
  the warn is a stderr side effect that doesn't alter output → those still pass. ✓
- prd-includes.test.ts (resolveIncludes, single-level) is untouched. ✓

## 6. Parallel-execution / file-disjoint check

- **vs S1 (in-flight, BUG-001 constants.ts JSDoc):** S1 edits `src/config/constants.ts` JSDoc ONLY.
  T2.S1 edits `src/core/session-utils.ts` (neutralizeResolvableTokens + 2 JSDoc spots) + `tests/unit/core/prd-markers.test.ts`.
  **Zero file overlap.** T2.S1 consumes the already-landed `neutralizeResolvableTokens` (from bugfix/001).
- **vs bugfix/001 (the idempotency BUG-002 fix that ADDED neutralizeResolvableTokens):** that's LANDED.
  T2.S1 adds the warn to its non-resolving branch + corrects the JSDoc it left behind ("Emits NO…").
  No conflict — additive.
- **vs T1.S3 / T1.S4 / T1.S1 (BUG-003 dedup-key / docs sweeps):** T1.S3 edits the visited-set sites
  (different lines in expandIncludesRecursive); T1.S4 sweeps README/CONFIGURATION/ARCHITECTURE/CLI_REF.
  T2.S1's lines (neutralizeResolvableTokens + the 2 JSDoc spots) are DISJOINT. Coordinate via sequencing.

## 7. Decisions locked

- **Warn condition in the gate**: `!resolves && token.endsWith('.md')` — identical to the main loop's
  `replacement === undefined && token.endsWith('.md')` (the gate's `!resolves` ≡ the main loop's
  `replacement === undefined` for the non-resolving case).
- **Identical message**: `` `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})` ``.
  Recommend `emitStaleIncludeWarning(token, abs)` helper shared by main loop + gate (DRY); inline
  identical literal acceptable.
- **Keep `out += m[0]`** (verbatim survivor) — output bytes UNCHANGED; idempotency preserved.
- **Two JSDoc spots corrected**: neutralizeResolvableTokens L593 + resolvePRD STALE-INCLUDE bullet L678-680
  (drop "depth-exceeded tokens" from the silent list).
- **TDD**: test (a) RED → implement → (a) GREEN; (b)(c) negative guards; (d) maxDepth=0 entry edge.
- **No double-warn** (gate returns early; token never reaches the main loop).
- **Real-tmpdir tests** (mkdtempSync, NO vi.mock) — mirror prd-markers.test.ts.