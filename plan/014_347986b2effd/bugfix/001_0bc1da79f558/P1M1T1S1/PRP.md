# PRP — P1.M1.T1.S1: Emit collision-proof, structurally non-resolvable include markers (TDD)

> Bugfix 001, **BUG-001 (MINOR)** — marker comments (`<!-- @include: … -->` / `<!-- @end-include -->`
> / `<!-- @include-ref: … -->`) contain a resolvable `@token` of their own. If a file named `include`/
> `end-include`/`include-ref` exists in the PRD dir, the marker's `@` matches `RESOLVE_TOKEN` and
> expands on a 2nd pass → idempotency fixed point breaks. Fix: make the markers structurally
> non-resolvable via technique B (non-path char after `@`). TDD: failing test first → fix → green.

---

## Goal

**Feature Goal**: Change the three include-marker comment strings in `expandIncludesRecursive` so each
is **structurally non-resolvable** against `RESOLVE_TOKEN` — provably zero captures even when a file
named exactly `include`/`end-include`/`include-ref` exists in the entry PRD's directory. This restores
the §2.3 L26 guarantee ("no resolvable `@token` of its own") and the unconditional idempotency MUST
(L27: `resolve(resolve(x)) === resolve(x)`) for marker-mode output under marker-word file collisions.

**Deliverable**:
1. **`src/core/session-utils.ts`** — change the three marker strings at lines ~498 and ~545 to use
   `@!` (technique B: `!` after `@` defeats the token group). Update JSDoc at ~429-469 and ~579-595.
2. **`tests/unit/core/prd-markers.test.ts`** — update existing byte-format assertions (lines 61, 70,
   88-92, 105-108, 113-115, 235-236) to the new format; rewrite the N2 comment at :239; add a NEW
   regression test (markers ON + collision files → `resolve(resolve(x)) === resolve(x)`).

**Success Definition**:
- `RESOLVE_TOKEN` produces ZERO captures against each new marker string (proven by regex trace).
- `resolvePRD(path, {markers:true})` output is byte-idempotent (`resolve(resolve(x)) === resolve(x)`)
  EVEN when files named `include`, `end-include`, `include-ref` exist in the PRD directory.
- All existing prd-markers.test.ts tests pass (updated to the new format) + the new collision test passes.
- `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Why

- **Spec compliance (§2.3 L26 + L27).** The PRD mandates marker comments contain "no resolvable
  `@token` of their own" and that `resolve(resolve(x)) === resolve(x)` unconditionally. Today the
  markers accidentally comply only because no such file happens to exist — an environmental
  coincidence, not a structural guarantee.
- **Hash/snapshot/delta consistency.** Marker-mode output feeds `hashPRD`/`snapshotPRD`/delta
  detection. If the fixed point breaks, the hash changes on re-resolution → spurious delta sessions.
- **Low practical impact, clean fix.** Marker mode is opt-in/default-off and the trigger is contrived
  (extensionless file named `include`). But the fix is a 3-character change (`@` → `@!`) that makes
  the guarantee structural rather than environmental — exactly what the spec asks for.

---

## What

### Technique B: non-path char after `@` (defeats the token group)

`RESOLVE_TOKEN = /(?<![\w./-])@([A-Za-z0-9_./-]+)/g`. The token group `[A-Za-z0-9_./-]+` requires
at least one path-class char after `@`. By placing `!` (NOT in `[A-Za-z0-9_./-]`) immediately after
`@`, the group can't start → zero captures.

**Regex trace** for `<!-- @!include: a.md -->`:
1. Regex finds `@` (preceded by space → lookbehind `(?<![\w./-])` passes — space isn't path-class).
2. Token group `[A-Za-z0-9_./-]+` tries to match after `@`. Next char: `!`. `!` ∉ `[A-Za-z0-9_./-]`.
3. `+` needs ≥1 match → **FAILS**. No capture at this position. No other `@` in the string. → **ZERO captures.** ✓

**The three new marker strings** (line ~498 elision ref + line ~545 expansion wrap):
```ts
// Elision reference (~line 498):
out += `<!-- @!include-ref: ${token} -->`;

// Expansion wrap (~line 545):
`<!-- @!include: ${token} -->\n${replacement}\n<!-- @!end-include -->`
```

**KEEP UNCHANGED**: everything else in `expandIncludesRecursive` — the dedup logic, elision
semantics, depth gate, stat/isFile/ENOENT/error handling, stale-warning condition. Only the three
marker string literals change.

### JSDoc updates (Mode A)
- `expandIncludesRecursive` JSDoc (~429-469): state the marker format is STRUCTURALLY non-resolvable
  (technique B: `!` after `@` defeats the `[A-Za-z0-9_./-]+` token group → RESOLVE_TOKEN zero-captures).
- `resolvePRD` MARKERS bullet (~579-595): same — cite the regex mechanism, state it's a true fixed
  point even under marker-word file collisions.

### Test updates (TDD — failing test FIRST, then fix, then green)
- **NEW regression test** (markers ON + collision files): create `include`, `end-include`,
  `include-ref` files (no extension) + a real `a.md` + `main.md`=`@a.md`; `o1 = resolvePRD(main,
  {markers:true})`; write `o1` to a file; `o2 = resolvePRD(that, {markers:true})`; assert `o2 === o1`.
  This FAILS with the old markers (`@include` expands into the collision file on pass 2).
- **Update existing byte assertions** to `@!include`/`@!end-include`/`@!include-ref`: lines 61, 70,
  88-92, 105-108, 113-115 (`.not.toContain('<!-- @include')` → `.not.toContain('<!-- @!include')`),
  235-236.
- **Rewrite the N2 comment** at :239: old claim "markers resolve to ENOENT non-.md tokens → silent
  verbatim" is WRONG → reword: "markers are STRUCTURALLY non-resolvable (`@!` defeats RESOLVE_TOKEN's
  token group) → zero captures on re-scan → pass-1 is a fixed point."

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ — root-cause + regex trace + recommended fix
- docfile: plan/014_347986b2effd/bugfix/001_0bc1da79f558/architecture/bug-analysis.md
  section: "BUG-001"
  why: The regex trace proving the old markers ARE resolvable, the reproduction steps, and the
        two fix techniques (A/B). This PRP implements technique B.
  critical: Changing the marker byte format is SAFE — markers are NOT parsed anywhere in src/ except
        session-utils.ts (verified by grep). Only tests assert the exact format.

# PATTERN FILE — the only source file edited
- file: src/core/session-utils.ts
  why: RESOLVE_TOKEN at :422. Elision marker at :498. Expansion markers at :545. JSDoc at ~429-469
        and ~579-595. Change ONLY the three marker string literals + JSDoc.
  pattern: "`<!-- @include-ref: ${token} -->`  →  `<!-- @!include-ref: ${token} -->`"
  gotcha: Do NOT change any logic — only the three string literals (3 characters total: `@` → `@!`).

# TEST FILE — update existing assertions + add regression test
- file: tests/unit/core/prd-markers.test.ts
  why: Real-tmpdir (no vi.mock) marker tests. Update byte assertions at L61/70/88-92/105-108/113-115/
        235-236 from @include→@!include etc. Rewrite N2 comment at :239. Add collision regression test.
  pattern: "await expect(resolvePRD(path, {markers:true})).resolves.toBe('<!-- @!include: a.md -->\\nA\\n<!-- @!end-include -->')"
  gotcha: The regression test MUST create REAL files named 'include', 'end-include', 'include-ref'
        (no extension) via writeFileSync — that's the collision condition. Assert resolve(resolve(x))===resolve(x).
```

### Known Gotchas

```ts
// CRITICAL — use @! (technique B), NOT @- or @. (those ARE path-class → token group still matches).
//   The char immediately AFTER @ must NOT be in [A-Za-z0-9_./-]. `!` is not. ✓

// CRITICAL — the regression test MUST use a REAL tmpdir (mkdtempSync/writeFileSync), NOT vi.mock.
//   The boundary/existence logic is only trustworthy against real files. The existing prd-markers.test.ts
//   already uses this pattern — mirror it.

// GOTCHA — update ALL existing byte-format assertions (L61/70/88-92/105-108/113-115/235-236), not just
//   some. Any surviving `@include` assertion will fail after the fix changes it to `@!include`.

// GOTCHA — rewrite the N2 comment at :239. It currently claims markers "resolve to ENOENT non-.md
//   tokens → silent verbatim" — this is now WRONG (markers are structurally non-resolvable, period).

// GOTCHA — the depth-gate elision (P1.M1.T2.S1, BUG-002) emits the SAME reference-comment format,
//   so it inherits collision-proofness automatically once this fix lands. Do NOT change it separately.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.
```

---

## Implementation Blueprint

### Implementation Tasks (TDD: failing test FIRST → fix → green)

```yaml
Task 1: ADD failing regression test in tests/unit/core/prd-markers.test.ts
  - ADD a new it() in the existing describe block: markers ON + collision files.
  - SETUP: writeFileSync(join(tmp,'a.md'),'A'); writeFileSync(join(tmp,'include'),'COLLISION');
        writeFileSync(join(tmp,'end-include'),'COLLISION'); writeFileSync(join(tmp,'include-ref'),'COLLISION');
        writeFileSync(join(tmp,'main.md'),'@a.md').
  - EXECUTE: o1 = await resolvePRD(join(tmp,'main.md'), {markers:true});
        writeFileSync(join(tmp,'pass2.md'), o1); o2 = await resolvePRD(join(tmp,'pass2.md'), {markers:true}).
  - ASSERT: expect(o2).toBe(o1) — byte-idempotent even with collision files present.
  - RUN: npx vitest run tests/unit/core/prd-markers.test.ts → NEW test FAILS (old markers expand @include into COLLISION).

Task 2: FIX the three marker strings in src/core/session-utils.ts
  - Line ~498: `<!-- @include-ref: ${token} -->` → `<!-- @!include-ref: ${token} -->`.
  - Line ~545: `<!-- @include: ${token} -->` → `<!-- @!include: ${token} -->` AND
        `<!-- @end-include -->` → `<!-- @!end-include -->`.
  - ADD a one-line comment at each site: "// @! is structurally non-resolvable: ! ∉ [A-Za-z0-9_./-]
        → RESOLVE_TOKEN's token group can't start → zero captures (technique B, PRD §2.3 L26)."
  - DO NOT change any logic — only the three string literals.

Task 3: UPDATE existing byte assertions in prd-markers.test.ts
  - Lines 61, 70: `'<!-- @include: a.md -->\\nA\\n<!-- @end-include -->'` → `'<!-- @!include: a.md -->\\nA\\n<!-- @!end-include -->'`.
  - Lines 88-92: `@include` → `@!include`, `@end-include` → `@!end-include` (all occurrences in the nested test).
  - Lines 105-108: same (inline expansion test).
  - Line 113-115: `.not.toContain('<!-- @include')` → `.not.toContain('<!-- @!include')`.
  - Lines 235-236: `@include-ref` → `@!include-ref`, `@include` → `@!include`.
  - Line 239 (N2 comment): rewrite to "markers are STRUCTURALLY non-resolvable (@! defeats RESOLVE_TOKEN's
        token group) → zero captures on re-scan → pass-1 is a fixed point."

Task 4: UPDATE JSDoc (Mode A)
  - expandIncludesRecursive (~429-469): state markers use @! (structurally non-resolvable via
        technique B — ! after @ defeats the token group); cite §2.3 L26.
  - resolvePRD MARKERS bullet (~579-595): same — cite the regex mechanism + fixed-point guarantee.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/core/prd-markers.test.ts → ALL green (new regression + updated assertions).
  - EXPECTED: all clean. The new collision test passes (markers don't expand on re-scan).
```

---

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run fix && npm run typecheck && npm run lint && npm run format:check
# Expected: clean. Three string-literal changes can't introduce type errors.
```

### Level 2: Unit Tests (the TDD gate)
```bash
npx vitest run tests/unit/core/prd-markers.test.ts
# After Task 1 (test added, markers NOT yet fixed): new collision test FAILS.
# After Task 2-3 (markers fixed + assertions updated): ALL green — collision test + existing tests.
```

### Level 3: Integration (regex-trace proof)
```bash
# Prove ZERO captures against each new marker string:
npx tsx -e "const RE=/(?<![\\w./-])@([A-Za-z0-9_./-]+)/g; const markers=['<!-- @!include: a.md -->','<!-- @!end-include -->','<!-- @!include-ref: a.md -->']; for(const m of markers){const caps=[...m.matchAll(RE)]; console.log(m, '→ captures:', caps.length);}"
# Expected: each → captures: 0.
```

### Level 4: Domain checks
- `@!` defeats the token group (`!` ∉ `[A-Za-z0-9_./-]`). ✓
- Markers are NOT parsed anywhere in src/ (verified — only tests assert the format). ✓
- The depth-gate elision (P1.M1.T2.S1) inherits collision-proofness automatically. ✓

---

## Final Validation Checklist
- [ ] Three marker strings changed to `@!include`/`@!end-include`/`@!include-ref` (technique B).
- [ ] RESOLVE_TOKEN produces zero captures against each new marker (proven by trace).
- [ ] New collision regression test passes: `resolve(resolve(x)) === resolve(x)` with collision files.
- [ ] All existing prd-markers.test.ts assertions updated to the new format.
- [ ] N2 comment at :239 rewritten (structural non-resolvability, not ENOENT coincidence).
- [ ] JSDoc on expandIncludesRecursive + resolvePRD MARKERS bullet updated.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

---

## Anti-Patterns to Avoid
- ❌ Don't use `@-` or `@.` after `@` — those ARE path-class → token group still matches. Use `@!`.
- ❌ Don't change any logic in expandIncludesRecursive — only the three string literals.
- ❌ Don't mock node:fs in the regression test — use a real tmpdir (the collision condition requires real files).
- ❌ Don't forget to update ALL existing byte assertions (6 sites) — any survivor `@include` fails.
- ❌ Don't leave the N2 comment claiming ENOENT coincidence — rewrite it to structural non-resolvability.

---

## Confidence Score
**10/10** — a 3-character string-literal change (`@` → `@!`) with a proven regex trace (zero
captures), a TDD regression test that's self-verifying (RED→GREEN), and verified safe format-change
(markers not parsed in src/). No external/runtime unknowns.