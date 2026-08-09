# PRP — P1.M1.T1.S1: Rewrite stale `PRD_INCLUDE_MARKERS` JSDoc to document the actual `@!include` / `@!end-include` / `@!include-ref` markers

> Bugfix 002, **BUG-001 (MINOR)** — the user-facing JSDoc on `PRD_INCLUDE_MARKERS` in
> `src/config/constants.ts` still documents the OLD marker format (`@include` / `@end-include`),
> contradicting the collision-proof `@!`-prefixed markers actually emitted by `expandIncludesRecursive`.
> This subtask rewrites ONLY that JSDoc block to match the emitted format. No code/behavior change.

---

## Goal

**Feature Goal**: Rewrite the `PRD_INCLUDE_MARKERS` JSDoc in `src/config/constants.ts` (~lines 1282-1300)
so it documents the ACTUALLY-EMITTED markers: `<!-- @!include: path -->`, `<!-- @!end-include -->`, and
`<!-- @!include-ref: path -->` (for elided second references). Add one sentence explaining the
collision-proof rationale. Keep the stale-`.md`-warning clause, the `@example` block, and the const
declaration unchanged.

**Deliverable**: The rewritten JSDoc block in `src/config/constants.ts`. No other file changes.

**Success Definition**:
- The JSDoc summary + `@remarks` name `@!include` / `@!end-include` / `@!include-ref` (not `@include`).
- One sentence explains: the `!` after `@` is outside `RESOLVE_TOKEN`'s `[A-Za-z0-9_./-]` char-class,
  making markers structurally non-resolvable → true idempotent fixed point even when files named
  `include`/`end-include`/`include-ref` exist.
- The existing stale-`.md`-warning clause is preserved.
- The `@example` block and `export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';` are unchanged.
- `npm run typecheck` clean; `npx vitest run tests/unit/core/prd-markers.test.ts` still green.

---

## Why

- **Documentation accuracy.** The `@!` collision-proof format was introduced by a prior bugfix
  (001, BUG-001) but the user-facing env-var JSDoc was never updated. Anyone reading the docs or
  writing an external marker parser sees `@include` / `@end-include`, contradicting the `@!include` /
  `@!end-include` / `@!include-ref` the code actually emits.
- **No code change, no risk.** This is a JSDoc-only edit — no behavior, no types, no tests to rewrite.
  The emitted format is already locked by `tests/unit/core/prd-markers.test.ts` (the BUG-001 collision
  test + the "wraps expanded includes" test). This subtask makes the documentation match.

---

## What

### The stale JSDoc (src/config/constants.ts ~lines 1282-1300)

```ts
/**
 * Environment variable name: emit `<!-- @include -->` markers around expanded includes
 * (PRD §2.3; consumed in S3).
 *
 * @remarks
 * When set, resolved include output emits `<!-- @include: path -->` / `<!-- @end-include -->`
 * comment markers, and a `.md` token that fails to resolve (stale include) emits a stderr
 * warning. This is declared here so S3 only adds behavior, not new plumbing; it is NOT
 * consumed by S1's `resolveIncludes`.
 *
 * @example
 * ```ts
 * import { PRD_INCLUDE_MARKERS } from './config/constants.js';
 *
 * console.log(PRD_INCLUDE_MARKERS); // 'PRD_INCLUDE_MARKERS'
 * console.log(process.env[PRD_INCLUDE_MARKERS]); // e.g. '1'
 * ```
 */
export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';
```

### The rewrite target

Rewrite the summary line + `@remarks` to:

```ts
/**
 * Environment variable name: emit `<!-- @!include -->` markers around expanded includes
 * (PRD §2.3). The `@!` prefix makes markers structurally non-resolvable: `!` is outside
 * RESOLVE_TOKEN's `[A-Za-z0-9_./-]` char-class, so the markers cannot match on re-scan —
 * guaranteeing a true idempotent fixed point even when files named `include`/`end-include`/
 * `include-ref` exist in the PRD directory.
 *
 * @remarks
 * When set, resolved include output emits three marker types:
 * - `<!-- @!include: path -->` / `<!-- @!end-include -->` — wraps each expanded include body.
 * - `<!-- @!include-ref: path -->` — marks an elided second-or-later reference (global-flat dedup).
 * A `.md` token that fails to resolve (stale include) emits a stderr warning.
 *
 * @example
 * ```ts
 * import { PRD_INCLUDE_MARKERS } from './config/constants.js';
 *
 * console.log(PRD_INCLUDE_MARKERS); // 'PRD_INCLUDE_MARKERS'
 * console.log(process.env[PRD_INCLUDE_MARKERS]); // e.g. '1'
 * ```
 */
export const PRD_INCLUDE_MARKERS = 'PRD_INCLUDE_MARKERS';
```

**KEEP UNCHANGED**: the `@example` block (lines 1293-1299), the `export const` declaration (line 1300),
and the stale-`.md`-warning clause (now embedded in `@remarks`).

### Success Criteria
- [ ] Summary line + `@remarks` name `@!include` / `@!end-include` / `@!include-ref`.
- [ ] One sentence explains the collision-proof rationale (`!` outside `[A-Za-z0-9_./-]`).
- [ ] Stale-`.md`-warning clause preserved.
- [ ] `@example` + `export const` declaration unchanged.
- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run tests/unit/core/prd-markers.test.ts` green (no behavior change).

---

## All Needed Context

### Documentation & References

```yaml
# MUST READ — the bug report confirming the stale JSDoc
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/architecture/bugfix_findings.md
  section: "BUG-001"
  why: Confirms the emitted format (@!include/@!end-include/@!include-ref) and the stale JSDoc
        location (constants.ts ~1280-1290). docs/CONFIGURATION.md:310 and README.md:135 already
        use the correct @!include format — this subtask touches ONLY constants.ts.

# PATTERN FILE — the only file edited
- file: src/config/constants.ts
  why: PRD_INCLUDE_MARKERS JSDoc at ~lines 1282-1300. Rewrite ONLY the summary + @remarks.
        Keep @example (1293-1299) and the const declaration (1300) byte-for-byte unchanged.
  pattern: "summary: * Environment variable name: emit <!-- @include --> ... → <!-- @!include --> ..."
  gotcha: Do NOT touch expandIncludesRecursive / the marker emission strings / docs/CONFIGURATION.md /
        README.md. This is a JSDoc-only edit to ONE block in ONE file.

# VERIFIED FACTS
- fact: "The emitted markers are <!-- @!include: path --> / <!-- @!end-include --> / <!-- @!include-ref: path --> — locked by tests/unit/core/prd-markers.test.ts."
- fact: "docs/CONFIGURATION.md:310 and README.md:135 ALREADY use the correct @! format — do NOT edit them here (Mode-B sweep P1.M1.T4 verifies them)."
- fact: "The collision-proof rationale: `!` ∉ [A-Za-z0-9_./-] → RESOLVE_TOKEN's token group [A-Za-z0-9_./-]+ can't start after @ → zero captures on re-scan."
```

### Known Gotchas
```ts
// CRITICAL — this is a JSDoc-ONLY edit. Do NOT change any code, the const declaration, or any test.
//   Do NOT touch session-utils.ts (the emission site) or docs/CONFIGURATION.md / README.md.

// GOTCHA — keep the @example block (lines 1293-1299) and the export const declaration (line 1300)
//   byte-for-byte unchanged. Only the summary + @remarks text changes.

// GOTCHA — keep the stale-.md-warning clause (relocate it into the @remarks bullet list).
//   The original says "a .md token that fails to resolve (stale include) emits a stderr warning" —
//   preserve this information in the rewrite.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.
```

---

## Implementation Blueprint

### Tasks (single edit)

```yaml
Task 1: EDIT src/config/constants.ts — rewrite the PRD_INCLUDE_MARKERS JSDoc (~lines 1282-1292)
  - REWRITE the summary line: <!-- @include --> → <!-- @!include -->; add the collision-proof
        rationale sentence (! outside [A-Za-z0-9_./-] → structurally non-resolvable → fixed point).
  - REWRITE @remarks: document all three marker types (@!include/@!end-include for expansion wrap;
        @!include-ref for elided second references). Keep the stale-.md-warning clause.
  - KEEP @example (1293-1299) and export const (1300) UNCHANGED.
  - DO NOT touch any other file (session-utils.ts, docs/, README.md, tests/).

Task 2: VERIFY
  - RUN: npm run fix → npm run typecheck.
  - RUN: npx vitest run tests/unit/core/prd-markers.test.ts → green (no behavior change).
  - EXPECTED: clean. A JSDoc-only edit cannot introduce type errors or test failures.
```

---

## Validation Loop

```bash
npm run fix                  # prettier --write (the JSDoc block may need reformatting)
npm run typecheck            # clean
npx vitest run tests/unit/core/prd-markers.test.ts   # green (no behavior change)
# Expected: all clean. This is a comment-only edit.
```

---

## Final Validation Checklist
- [ ] JSDoc summary + @remarks name `@!include`/`@!end-include`/`@!include-ref`.
- [ ] Collision-proof rationale present (`!` outside char-class → structurally non-resolvable).
- [ ] Stale-`.md`-warning clause preserved.
- [ ] `@example` + `export const` unchanged.
- [ ] `npm run typecheck` clean; prd-markers tests green.
- [ ] No other file modified.

---

## Anti-Patterns to Avoid
- ❌ Don't change any code, the const declaration, or any test — this is a JSDoc-only edit.
- ❌ Don't touch session-utils.ts (emission site), docs/CONFIGURATION.md, or README.md.
- ❌ Don't drop the stale-`.md`-warning clause — relocate it into the @remarks bullets.
- ❌ Don't forget to document `@!include-ref` (the elision reference marker) — it's one of the three.

---

## Confidence Score
**10/10** — a JSDoc-only rewrite of one block in one file, with the exact before/after text specified,
no code/behavior/test change, and the emitted format already locked by existing tests.