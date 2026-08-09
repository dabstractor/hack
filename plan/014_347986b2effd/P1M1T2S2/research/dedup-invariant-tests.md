# Research — New §2.3 invariant tests (N1–N7) for dedup/elision/idempotency/blowup

P1.M1.T2.S2 (plan 014). Adds seven NEW test cases (no predecessors — these invariants didn't exist under
the old model) that lock in the §2.3 "No duplication (dedup)" / elision / idempotency / blowup-protection
guarantees of the completed `expandIncludesRecursive` rewrite (P1.M1.T1.S1). All use REAL tmpdir fixtures.

## 1. S1 dependency + disjoint-edit proof

S1 (P1.M1.T2.S1, Implementing) REWRITES 6 EXISTING tests (5 in prd-resolve.test.ts T1–T5, 1 in
prd-markers.test.ts M1) — fixtures byte-identical, only titles/comments/assertions change. S1 < S2
ordering within P1.M1.T2 ⇒ S1 is merged when T2.S2 executes. T2.S2 ADDS new `it()` blocks (N1–N7) in
DISJOINT describe blocks from S1's rewrites. No source edits (the implementation is Complete; the peer
JSDoc is P1.M1.T1.S2 Complete).

Shared-file note: BOTH S1 and T2.S2 edit prd-resolve.test.ts + prd-markers.test.ts, but at disjoint
locations (S1 rewrites existing its; T2.S2 appends new describe blocks). One import-line touch by T2.S2:
add `vi` to prd-resolve.test.ts's vitest import (needed for N6's `console.warn` spy) — S1 doesn't touch
that import line.

## 2. The implementation behavior under test (verified — expandIncludesRecursive, session-utils.ts:431)

- **Global-flat visited set** passed by reference; **entry pre-seeded** (`resolvePRD`: `new Set([absEntry])`).
- **First encounter**: `visited.add(abs)` BEFORE descending → body expanded inline.
- **Second+ encounter** (`visited.has(abs)`): **ELIDE** — markers off → emit NOTHING (leaves the
  surrounding whitespace, e.g. `'X @D.md Y'` → `'X  Y'` double-space); markers on → emit the stable
  non-resolvable comment `<!-- @include-ref: ${token} -->`.
- **Elision is SILENT** — the `continue` skips the stale-include `console.warn` (elision is a successful
  resolution, not a missing file).
- `maxDepth` is defense-in-depth only; dedup itself bounds recursion (cycles/diamonds terminate without it).
- `resolvePRD(path, { markers: true })` enables markers (opts wins over `PRD_INCLUDE_MARKERS` env).

## 3. The marker-comment idempotency proof (critical for N2)

The marker comments emitted are `<!-- @include: D.md -->`, `<!-- @end-include -->` (around expansions)
and `<!-- @include-ref: D.md -->` (for elisions). On a SECOND resolution pass these are scanned by
`RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g`:
- `@include` → captures `include` (stops at `:`) → `resolve(baseDir,'include')` → ENOENT → does NOT end
  in `.md` → **silent verbatim** (no stale warning).
- `@include-ref` → captures `include-ref` → ENOENT → not `.md` → silent verbatim.
- `@end-include` → captures `end-include` → ENOENT → not `.md` → silent verbatim.
- `D.md` (inside the comment) has NO leading `@` → never matched.

So no marker comment token RESOLVES on re-scan → the marker-on output is a fixed point
(`resolve(resolve(x)) === resolve(x)`). N2 asserts this directly (write pass-1 output to a temp file,
resolvePRD it again with `{ markers: true }`, assert byte-identical). (None of `include`/`include-ref`/
`end-include` are created as files in the fixture → ENOENT is guaranteed.)

## 4. The seven tests (fixtures + exact assertions)

### N1 — DIAMOND DEDUP → prd-resolve.test.ts
Fixture: `D.md='D-BODY'`; `B.md='B-OPEN @D.md B-CLOSE'`; `C.md='C-OPEN @D.md C-CLOSE'`;
`A.md='A-TOP @B.md @C.md A-BOT'` (B before C); `main.md='@A.md'`.
Resolution (markers off): D first-encountered under B (B precedes C in A); C's `@D.md` elided.
Expected EXACT: `'A-TOP B-OPEN D-BODY B-CLOSE C-OPEN  C-CLOSE A-BOT'` (double space after C-OPEN from elision).
Assert: `toBe(...)`; `split('D-BODY').length === 2` (once); `not.toContain('@D.md')`;
`indexOf('D-BODY') < indexOf('C-OPEN')` (first-encounter position under B).

### N2 — MARKER-MODE REFERENCE COMMENT → prd-markers.test.ts
Same diamond; `resolvePRD(main, { markers: true })`. The elided C's `@D.md` → `<!-- @include-ref: D.md -->`.
Assert: `includes('<!-- @include-ref: D.md -->')`; `includes('<!-- @include: D.md -->')` (first-encounter
marker); `split('D-BODY').length === 2`. **Idempotency:** write pass-1 output to `<tmp>/pass2.md`,
`out2 = await resolvePRD('<tmp>/pass2.md', { markers: true })`, `expect(out2).toBe(out1)` (byte-identical
→ the ref comment is self-protecting; §3 proof).

### N3 — NO-MARKER ELISION → prd-resolve.test.ts
Same diamond; markers off (default). Assert: `not.toContain('@D.md')` (no survivor);
`not.toContain('@include-ref')` (no ref comment — contrast with N2); `split('D-BODY').length === 2`.

### N4 — IDEMPOTENCY FIXED POINT → prd-resolve.test.ts (THE headline invariant)
Diamond-heavy fixture: `main.md='@a.md\n@b.md'`; `a.md='A-body @c.md'`; `b.md='B-body @c.md'`;
`c.md='C-body @a.md'` (mutual back-ref; a already visited → elided).
`out1 = await resolvePRD(main)`; `writeFileSync(join(tmp,'pass2.md'), out1)`;
`out2 = await resolvePRD(join(tmp,'pass2.md'))`. Assert: `expect(out2).toBe(out1)` (byte-identical);
`out1` does not match `/@a\.md|@b\.md|@c\.md/` (no resolvable survivors — elision is what MAKES it a fixed point).

### N5 — EXPONENTIAL-BLOWUP GUARD → prd-resolve.test.ts
N=8 mutually-referencing files: `f{i}.md = 'F{i} @f{(i+1)%8}.md @f{(i+2)%8}.md'`; `main.md='@f0.md'`.
(Under the OLD model this expanded exponentially with depth → string overflow crash. Under dedup each
file imports once → linear.) Assert: resolves WITHOUT throwing (no RangeError — the primary regression
signal); `result.split('F0').length === 2` … `F7` once each (each file imported at most once → bounded);
`result.length < totalInput * 2` where `totalInput = Σ file sizes` (linear, not exponential).

### N6 — ENTRY-IS-ITS-OWN-CYCLE → prd-resolve.test.ts
`main.md='X @main.md Y'` (entry includes ITSELF directly). Entry pre-seeded → `@main.md` elided on first
scan. Expected: `'X  Y'` (double space). Assert: `toBe('X  Y')`; a local `vi.spyOn(console,'warn')` is
NOT called (elision is silent); completes (no infinite loop). NOTE: add `vi` to prd-resolve.test.ts's
vitest import for the spy.

### N7 — RESOLVEINCLUDES SINGLE-LEVEL → prd-resolve.test.ts
`resolveIncludes` (session-utils.ts:376) is single-level — NO visited set, NO recursion. A DIRECT
duplicate `@token` in one file: content `'@a.md @a.md'`, `a.md='A'`, baseDir=tmp → `'A A'` (BOTH expand;
no dedup). Assert: `expect(await resolveIncludes('@a.md @a.md', tmp)).toBe('A A')`. describe block
documents this is the single-level contract (no dedup) — contrast with resolvePRD's global-flat dedup.
Import `resolveIncludes` from session-utils. (If it's a thin shim, the test still locks its contract;
do not expand scope.)

## 5. Placement + naming (per contract DOCS: titles name the §2.3 invariant)

- **prd-resolve.test.ts** (add `vi` to import): new describe blocks — `resolvePRD — diamond dedup &
  first-encounter position (§2.3)` (N1, N3 share a helper); `resolvePRD — idempotency fixed point (§2.3)`
  (N4); `resolvePRD — exponential-blowup guard (§2.3 dedup bounds recursion)` (N5);
  `resolvePRD — entry-self-include elision (§2.3)` (N6); `resolveIncludes — single-level, no dedup (§2.3)`
  (N7).
- **prd-markers.test.ts**: `it('elided diamond ref becomes a self-protecting reference comment under
  markers (§2.3 idempotency)')` (N2) — appended to the existing markers describe (or a new one).

## 6. Conventions to mirror (from the existing files)
- REAL tmpdir: `tmp = mkdtempSync(join(tmpdir(),'prd-…-'))`; `afterEach(() => rmSync(tmp,{recursive:true,force:true}))`.
- Fixtures: `writeFileSync(join(tmp,'name.md'), 'body')`. `resolvePRD(join(tmp,'main.md'))`.
- Imports: `resolvePRD`, `SessionFileError` from `'../../../src/core/session-utils.js'`; N7 also imports
  `resolveIncludes`; N2/N6 use `vi` (prd-markers already imports it; prd-resolve needs it added).
- prd-markers.test.ts afterEach already does `vi.unstubAllEnvs(); vi.restoreAllMocks();` — a local spy in
  N2 (if any) is fine; N2 needs no spy (elision is silent; the idempotency check is the assertion).