# PRP — P1.M1.T2.S1: Add the stale-`.md` stderr warning to `neutralizeResolvableTokens` + correct the two now-wrong JSDoc spots

> Bugfix `002_2b460dab1a1f`, **BUG-002 (MINOR)**. PRD §2.3 unconditionally: "A `.md` token that fails
> to resolve (stale include) MUST emit a stderr warning." The main recursive loop warns
> (`expandIncludesRecursive` L550-554), but the **depth-gate path does not** — `neutralizeResolvableTokens`
> leaves a non-resolving `.md` token verbatim with ZERO warning, defeating typo-detection for deeply-
> nested specs. **Fix: add the identical `console.warn` to the gate's non-resolving branch (guarded
> `!resolves && token.endsWith('.md')`), keep the verbatim output, and correct the two JSDoc spots that
> claim "no warning."** Depends on nothing in-flight (S1 is `constants.ts` JSDoc — disjoint file).
> `neutralizeResolvableTokens` already exists (landed in bugfix/001). TDD: failing test first → fix → green.

---

## Goal

**Feature Goal**: Make a stale `.md` token emit exactly one stderr warning per resolve pass **regardless
of depth** — including at the `maxDepth` gate. Add the main-loop-identical `console.warn` to
`neutralizeResolvableTokens`'s non-resolving branch (guarded `!resolves && token.endsWith('.md')`), keep
`out += m[0]` (verbatim — output bytes UNCHANGED, idempotency preserved), and correct the two JSDoc spots
that now claim the gate emits no warning.

**Deliverable**:
1. **`src/core/session-utils.ts`** — (a) in `neutralizeResolvableTokens`, add the stale-`.md` `console.warn`
   (identical message to the main loop L553) before the verbatim arm; (b) [recommended] extract
   `emitStaleIncludeWarning(token, abs)` shared by the main loop + the gate (DRY, structurally identical);
   (c) correct the `neutralizeResolvableTokens` JSDoc (L593) + the `resolvePRD` STALE-INCLUDE WARNING
   bullet (L678-680).
2. **`tests/unit/core/prd-markers.test.ts`** — add a `describe('resolvePRD — stale .md warning at the
   maxDepth gate (BUG-002)')` block: (a) RED stale-`.md`-at-gate warns 1×; (b) negative non-`.md` silent;
   (c) negative resolvable-elided-and-silent; (d) `maxDepth=0` entry edge warns. Real-tmpdir, `vi.spyOn(console,'warn')`.

**Success Definition**:
- A stale `.md` token at the gate (`opts.maxDepth=1`, or default depth in a deep chain, or `maxDepth=0`
  at the entry) emits EXACTLY ONE `console.warn` with the message
  `[prd-resolver] stale include '@<token>': path does not resolve to an existing file (<abs>)`.
- Elided (resolvable) tokens, non-`.md` survivors, and successfully-resolved tokens at the gate are SILENT.
- Output bytes are UNCHANGED (the verbatim survivor is still emitted) → `resolve(resolve(x)) === resolve(x)`
  still holds; re-resolution re-warns once per pass (spec-correct).
- No double-warn (a gate token never reaches the main loop — the gate returns early).
- The two JSDoc spots no longer claim the gate is silent on stale `.md`.
- `npm run test:run -- prd-markers prd-resolve` GREEN; `npm run typecheck && npm run lint` clean.

---

## Why

- **Spec compliance (§2.3 — unconditional MUST).** The PRD states the stale-`.md` warning without
  qualification. The gate's silence is a genuine deviation; the fix makes the warning fire uniformly at
  every depth, restoring the typo-detection purpose for deeply-nested specs (reachable at default
  maxDepth=10, or trivially via a user-lowered `PRD_INCLUDE_MAX_DEPTH`).
- **Low real-world impact, clean fix.** Default maxDepth=10 needs a 10-deep chain whose deepest member
  references a missing `.md` (pathological for real distributed PRDs). But the fix is a 4-line insertion
  (+ a recommended DRY helper) that mirrors the proven main-loop warn exactly. Per the bug report's
  Recommendation: "Route stale `.md` detection through neutralizeResolvableTokens so a non-resolving
  `.md` token at the maxDepth gate still emits exactly one stderr warning per the §2.3 MUST."
- **Output-safe.** The warn is a stderr side effect; the verbatim survivor is still emitted, so
  idempotency (`resolve(resolve(x)) === resolve(x)`) and hashing/delta-detection are unaffected.
- **Scope discipline.** T2.S1 = the gate warn + helper + 2 JSDoc spots + the gate-warn tests. S1 (parallel,
  BUG-001) is `constants.ts` JSDoc. T1.S3 (BUG-003) is the visited-set dedup-key. T1.S4 is the docs sweep.
  No overlap.

---

## What

### User-visible behavior
None at runtime under realistic inputs. Indirectly: for deeply-nested specs (or a lowered
`PRD_INCLUDE_MAX_DEPTH`), a typo'd `.md` include that lands at/beyond the depth gate now surfaces on
stderr (one warning per resolve pass) instead of silently surviving verbatim. Output bytes are unchanged.

### Technical requirements (exact contract)

**Edit A — `src/core/session-utils.ts` `neutralizeResolvableTokens` non-resolving branch**: insert the
warn before the verbatim arm. The function already computes `token`, `abs`, and `resolves`. Current:
```ts
out += resolves
  ? markers
    ? elisionRefComment(token)
    : ''
  : m[0]; // non-resolvable prose → verbatim
```
New (warn + keep verbatim):
```ts
if (!resolves && token.endsWith('.md')) {
  emitStaleIncludeWarning(token, abs);   // PRD §2.3 MUST — identical to the main-loop warn
}
out += resolves
  ? markers
    ? elisionRefComment(token)
    : ''
  : m[0]; // non-resolvable → verbatim (stale .md warned above; output bytes unchanged)
```

**Edit B — [recommended] `emitStaleIncludeWarning(token, abs)` helper** (place near `elisionRefComment`),
used by BOTH the main loop (L550-554) AND the gate, so the message is a single source of truth:
```ts
/** Emit the stale-include stderr warning (PRD §2.3 MUST). Routed via console.warn → process.stderr
 *  (the pino logger writes stdout; §2.3 requires stderr). Shared by the main loop + the depth gate. */
function emitStaleIncludeWarning(token: string, abs: string): void {
  console.warn(
    `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
  );
}
```
Then refactor the main loop (L550-554) from the inline `console.warn(...)` to `emitStaleIncludeWarning(token, abs);`.
(If you prefer not to touch the main-loop line, inline the IDENTICAL literal in the gate — both copies
MUST match L553 byte-for-byte. The helper is recommended to guarantee that structurally.)

**Edit C — JSDoc spot 1: `neutralizeResolvableTokens` (L593)**:
- BEFORE: "Emits NO stale-include warning (elision = success; verbatim = non-resolving prose, which is silent)."
- AFTER: "A non-resolvable `.md` token (ENOENT or directory) at the gate emits exactly one **stderr**
  warning via `console.warn` (PRD §2.3 MUST — same message as the main loop). Elided (resolvable) tokens,
  non-`.md` survivors, and successfully-resolved tokens are silent."

**Edit D — JSDoc spot 2: `resolvePRD` STALE-INCLUDE WARNING bullet (L678-680)** — remove "depth-exceeded
tokens" from the silent list:
- BEFORE: "Non-`.md` tokens, elided references (cycles/diamonds/back-edges — elision is a SUCCESSFUL
  resolution), depth-exceeded tokens, and successfully-resolved tokens emit NO warning (PRD §2.3)."
- AFTER: "Non-`.md` tokens, elided references (cycles/diamonds/back-edges — elision is a SUCCESSFUL
  resolution), and successfully-resolved tokens emit NO warning. A stale `.md` at the maxDepth gate ALSO
  emits exactly one warning (the depth-gate scan runs the same stale-`.md` check as the main loop) — only
  elided/resolved/non-`.md` tokens are silent everywhere (PRD §2.3)."

### Success Criteria
- [ ] `neutralizeResolvableTokens` warns once for `!resolves && token.endsWith('.md')` (identical message to L553).
- [ ] Gate's elided/resolved/non-`.md` tokens stay silent; verbatim survivor still emitted (output unchanged).
- [ ] `emitStaleIncludeWarning` helper shared by main loop + gate (recommended), OR identical inline literal.
- [ ] JSDoc L593 + resolvePRD STALE-INCLUDE bullet (L678-680) corrected.
- [ ] Tests (a)(d) RED→GREEN; (b)(c) guards pass; existing prd-markers/prd-resolve tests stay green.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the exact
`neutralizeResolvableTokens` non-resolving branch (with line numbers), the exact main-loop warn message
(L553) to mirror, the verbatim before/after for both JSDoc spots, the no-double-warn proof, the 4 test
recipes (with traces), and the executable validation commands are all below.

### Documentation & References

```yaml
# MUST READ — BUG-002 root cause + reproduction + the route-through recommendation
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/architecture/bugfix_findings.md
  section: "BUG-002"
  why: Confirms the gate's silence, the opts.maxDepth=1 + 10-deep reproductions, and the
        "Route stale .md detection through neutralizeResolvableTokens" recommendation this PRP implements.

# MUST READ — the fix + traces + the 2 JSDoc before/after + no-double-warn proof (authored here)
- docfile: plan/014_347986b2effd/bugfix/002_2b460dab1a1f/P1M1T2S1/research/gate-stale-warning-fix.md
  section: "2. Verified source state" and "3. The two JSDoc spots to correct" and "4. TDD" and "6. Parallel-execution check"
  why: The verbatim warn insertion, the identical-message requirement, the L593 + L678-680 before/after,
        the 4 test traces (a/b/c/d), the no-double-warn proof, and the disjoint-from-S1/T1.S3 check.
        READ BEFORE IMPLEMENTING.

# PATTERN FILE 1 — the only source file edited
- file: src/core/session-utils.ts
  why: neutralizeResolvableTokens (the fix site — non-resolving branch). The main-loop warn (L550-554 —
        the message to mirror / refactor into emitStaleIncludeWarning). JSDoc L593 + resolvePRD STALE-
        INCLUDE bullet L678-680 (the 2 spots to correct). elisionRefComment (the sibling helper to place
        emitStaleIncludeWarning near). stat/resolve/SessionFileError already imported.
  pattern: "if (replacement === undefined && token.endsWith('.md')) { console.warn(`[prd-resolver] stale include '@${token}': ...`); }"
  gotcha: The gate's condition is !resolves (NOT replacement===undefined — the gate has no `replacement`
        var; `resolves` is its boolean). The message string MUST be byte-identical to L553.

# PATTERN FILE 2 — the test file (real-tmpdir, vi.spyOn(console,'warn'))
- file: tests/unit/core/prd-markers.test.ts
  why: The existing stale-warning test (L122-128) is the template: vi.spyOn(console,'warn').mockImplementation(()=>{});
        writeFileSync(join(tmp,'main.md'),'@missing.md'); out=resolvePRD(...); expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('missing.md'). describe('resolvePRD — markers,
        stale warnings, idempotency') at L37. mkdtempSync/tmp + afterEach rmSync. resolvePRD from
        '../../../src/core/session-utils.js'.
  pattern: "const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); … expect(warn).toHaveBeenCalledTimes(1);"
  gotcha: Tests use REAL tmpdir (mkdtempSync), NOT vi.mock node:fs. The gate tests pass {maxDepth:1} (or
        {maxDepth:0} for the entry edge) to force the gate. The (c) resolvable-elided test asserts the
        DOUBLE-SPACE output ('G  END') — elision drops @h.md, leaving the surrounding spaces (do NOT tidy).

# VERIFIED FACTS
- fact: "neutralizeResolvableTokens already computes token, abs=resolve(baseDir,token), and resolves (true iff existing FILE). The warn needs only !resolves && token.endsWith('.md')."
- fact: "Main-loop warn message (L553): `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`. The gate must emit the IDENTICAL string."
- fact: "No double-warn: a gate token only passes through neutralizeResolvableTokens (the gate returns early); it never reaches the main loop's warn."
- fact: "Output bytes UNCHANGED — the verbatim survivor (m[0]) is still emitted; re-resolution re-warns once per pass (spec-correct) but output is identical → idempotency holds."
- fact: "maxDepth=0 fires the gate at the entry (depth 0); a stale .md in the entry warns (uniform treatment — entry NOT exempt)."
- fact: "The existing L122 stale-warning test uses DEFAULT maxDepth (main loop, not gate) → still passes (unchanged)."
- fact: "All include tests use REAL tmpdir (mkdtempSync), NOT vi.mock — preserve this."
```

### Current Codebase tree (relevant slice)

```bash
src/core/session-utils.ts           # EDIT — neutralizeResolvableTokens warn + (rec)emitStaleIncludeWarning helper + 2 JSDoc spots
tests/unit/core/prd-markers.test.ts # EDIT — add describe('… stale .md warning at the maxDepth gate (BUG-002)') (4 tests)
```

### Desired Codebase tree with files to be edited

```bash
src/core/session-utils.ts           # MODIFIED (warn insertion + optional shared helper + main-loop refactor to helper + 2 JSDoc spots)
tests/unit/core/prd-markers.test.ts # MODIFIED (1 new describe block, 4 tests; real-tmpdir preserved)
# No other files. S1 (constants.ts JSDoc) is disjoint. T1.S3 (visited-set) / T1.S4 (docs) are separate.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the gate's warn condition is `!resolves && token.endsWith('.md')` (the gate has no
//   `replacement` var — `resolves` is its boolean). The main loop's is `replacement === undefined &&
//   token.endsWith('.md')`. Same semantics for the non-resolving case; do NOT reference `replacement`
//   in the gate.

// CRITICAL — the warn message MUST be byte-identical to L553. Recommend emitStaleIncludeWarning(token,abs)
//   shared by both sites (DRY, structurally identical). If inlining, copy L553's template literal
//   verbatim — any drift makes the two warnings inconsistent.

// CRITICAL — keep `out += m[0]` (the verbatim survivor) in the non-resolving branch. The warn is a SIDE
//   EFFECT only; output bytes must NOT change (idempotency + hashing/delta-detection depend on it).

// CRITICAL — do NOT warn for elided (resolvable) tokens, non-`.md` tokens, or resolved tokens. ONLY
//   `!resolves && token.endsWith('.md')`. (Test (b) locks non-`.md` silent; test (c) locks resolvable
//   elided+silent.)

// CRITICAL — no double-warn: a gate token never reaches the main loop (the gate returns early). Do NOT
//   add a guard against double-warning — it's structurally impossible.

// GOTCHA — maxDepth=0 fires the gate at the ENTRY (depth 0). A stale .md in the entry warns (test (d)).
//   This is spec-correct (unconditional MUST) — do NOT exempt the entry.

// GOTCHA — the (c) resolvable-elided test asserts the DOUBLE-SPACE output ('G  END') — elision drops
//   @h.md, leaving the surrounding whitespace. Do NOT "tidy" to a single space.

// GOTCHA — TDD order: test (a) FAILS before the fix (gate emits 0 warns); implement → (a) PASSES.
//   (b)(c) pass before+after (guards); (d) FAILS before (maxDepth=0 entry), PASSES after.

// GOTCHA — the existing L122 stale-warning test (default maxDepth, main loop) is UNCHANGED — do NOT
//   edit it. The BUG-002 idempotency tests (prd-resolve.test.ts, bugfix/001) assert output/fixed-point,
//   not warn — unaffected (output bytes unchanged).

// GOTCHA — do NOT touch expandIncludesRecursive's dedup/cycle/diamond logic, the visited set (T1.S3 owns
//   the realpath-key change), the marker emission, or constants.ts (S1 owns it). T2.S1 is the gate warn +
//   helper + 2 JSDoc spots ONLY.

// GOTCHA — prettier is ERROR-enforced. Run `npm run fix` before format:check.

// GOTCHA — vitest 100% coverage on src: the new warn branch (`!resolves && token.endsWith('.md')` true)
//   is covered by tests (a) and (d). The `!resolves && !token.endsWith('.md')` (no-warn) branch is
//   covered by (b). The `resolves` (elide, no-warn) branch by (c). All branches hit.
```

---

## Implementation Blueprint

### Data models and structure
None new — the helper reuses `console.warn`. No types/constants.

### Implementation Tasks (TDD: failing test FIRST → implement → green)

```yaml
Task 1: EDIT tests/unit/core/prd-markers.test.ts — ADD the gate-stale-warning describe (RED)
  - ADD describe('resolvePRD — stale .md warning at the maxDepth gate (BUG-002)') inside the file's style.
        Real tmpdir (mkdtempSync; afterEach rmSync); vi.spyOn(console,'warn').mockImplementation(()=>{}).
  - (a) it('warns once for a stale .md token at the maxDepth gate'): g.md='G @missing.md END', main='@g.md';
        out=resolvePRD(main,{maxDepth:1}); expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('missing.md'); expect(out).toBe('G @missing.md END').
  - (b) it('does NOT warn for a non-.md token at the gate'): g.md='G @missing.txt END', main='@g.md';
        resolvePRD(main,{maxDepth:1}); expect(warn).not.toHaveBeenCalled().
  - (c) it('elides (not warns) a resolvable token at the gate'): g.md='G @h.md END', h.md='H', main='@g.md';
        out=resolvePRD(main,{maxDepth:1}); expect(warn).not.toHaveBeenCalled(); expect(out).toBe('G  END').
  - (d) it('warns for a stale .md in the entry at maxDepth=0 (uniform edge)'): main='@missing.md';
        out=resolvePRD(main,{maxDepth:0}); expect(warn).toHaveBeenCalledTimes(1); expect(out).toBe('@missing.md').
  - RUN: npx vitest run tests/unit/core/prd-markers.test.ts → (a) and (d) FAIL (gate currently silent);
        (b)(c) pass (guards).
  - PLACEMENT: append the describe (or nest under the existing 'markers, stale warnings, idempotency' describe).

Task 2: EDIT src/core/session-utils.ts — add emitStaleIncludeWarning helper (recommended) + refactor main loop
  - ADD function emitStaleIncludeWarning(token, abs): void { console.warn(`[prd-resolver] stale include
        '@${token}': path does not resolve to an existing file (${abs})`); } (near elisionRefComment).
  - REFACTOR the main-loop warn (L550-554) to call emitStaleIncludeWarning(token, abs) (was inline literal).
        [If avoiding the main-loop line, skip this refactor and inline the identical literal in the gate.]
  - (Safe one-line refactor of the already-landed main-loop literal; guarantees byte-identical format.)

Task 3: EDIT src/core/session-utils.ts — add the warn to neutralizeResolvableTokens (GREEN)
  - INSERT before the ternary's verbatim arm: `if (!resolves && token.endsWith('.md')) { emitStaleIncludeWarning(token, abs); }`
  - KEEP `out += resolves ? ... : m[0];` (verbatim survivor — output unchanged).
  - DO NOT: warn for elided/resolved/non-.md; remove the verbatim `m[0]`; touch the main loop's condition;
        or add a double-warn guard (structurally impossible).
  - EXPECTED: tests (a) and (d) now PASS (gate warns once); (b)(c) still pass.

Task 4: EDIT src/core/session-utils.ts — correct the 2 JSDoc spots
  - L593 (neutralizeResolvableTokens): "Emits NO stale-include warning …" → "A non-resolvable .md token
        at the gate emits exactly one stderr warning (PRD §2.3 MUST — same message as the main loop);
        elided/non-.md/resolved tokens are silent."
  - L678-680 (resolvePRD STALE-INCLUDE bullet): remove "depth-exceeded tokens" from the silent list;
        add that a stale .md at the maxDepth gate ALSO warns once (the gate scan runs the same check).
  - DO NOT touch the inline L548 comment (it accurately describes the MAIN LOOP — gate tokens never
        reach it); optionally add a clarifying note that gate tokens warn in neutralizeResolvableTokens.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npm run test:run -- prd-markers prd-resolve → ALL GREEN (new gate-warn tests + existing
        stale-warning/marker/idempotency tests + prd-resolve unaffected).
  - EXPECTED: all clean/green. If (a)/(d) still fail, confirm the warn landed in neutralizeResolvableTokens
        (not the main loop) and the condition is !resolves && token.endsWith('.md'). If (c) fails on the
        output, confirm you didn't remove the verbatim m[0] (the (c) test is the elide path, separate).
```

### Implementation Patterns & Key Details

```ts
// ---- the gate warn insertion (neutralizeResolvableTokens, before the ternary) ----
if (!resolves && token.endsWith('.md')) {
  emitStaleIncludeWarning(token, abs);   // PRD §2.3 MUST — identical to the main-loop warn
}
out += resolves
  ? markers ? elisionRefComment(token) : ''
  : m[0];                                // non-resolvable → verbatim (stale .md warned above)

// ---- the shared helper (near elisionRefComment) ----
function emitStaleIncludeWarning(token: string, abs: string): void {
  console.warn(
    `[prd-resolver] stale include '@${token}': path does not resolve to an existing file (${abs})`
  );
}
// (main loop L550-554 refactored to: if (replacement === undefined && token.endsWith('.md')) emitStaleIncludeWarning(token, abs);)

// ---- the 4 tests (real tmpdir; vi.spyOn(console,'warn')) ----
it('warns once for a stale .md token at the maxDepth gate', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(join(tmp, 'g.md'), 'G @missing.md END');
  writeFileSync(join(tmp, 'main.md'), '@g.md');
  const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain('missing.md');
  expect(out).toBe('G @missing.md END');   // verbatim survivor — output unchanged
});
it('elides (not warns) a resolvable token at the gate', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeFileSync(join(tmp, 'g.md'), 'G @h.md END');
  writeFileSync(join(tmp, 'h.md'), 'H');
  writeFileSync(join(tmp, 'main.md'), '@g.md');
  const out = await resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });
  expect(warn).not.toHaveBeenCalled();
  expect(out).toBe('G  END');              // @h.md ELIDED (double space) — cross-checks BUG-002 idempotency
});
```

### Integration Points

```yaml
NO DEPENDENCIES ON IN-FLIGHT WORK: neutralizeResolvableTokens is LANDED (bugfix/001). S1 (parallel,
  constants.ts JSDoc) is a disjoint file. T1.S3 (BUG-003 visited-set realpath key) edits different lines
  in expandIncludesRecursive; T1.S4 (docs sweep) edits docs/. T2.S1's lines (neutralizeResolvableTokens
  + 2 JSDoc spots + the main-loop warn refactor) are DISJOINT.

NO OUTPUT CHANGE: the warn is a stderr side effect; the verbatim survivor is still emitted → idempotency
  (resolve(resolve(x))===resolve(x)) + hashing/delta-detection UNAFFECTED. The BUG-002 idempotency fix
  (bugfix/001) and the existing stale-warning/marker tests all stay green.

DOWNSTREAM: callers that observe stderr (no interface change) now see the gate's stale-.md warning too.
  T1.S4 (docs sweep) verifies README/CONFIGURATION/ARCHITECTURE/CLI_REF stale-warning accuracy.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run fix                  # lint:fix + prettier --write (run after the edits)
npm run typecheck            # tsc --noEmit -p tsconfig.build.json — clean
npm run lint                 # eslint . --ext .ts — clean
npm run format:check         # clean
# Expected: clean. The warn + helper are straightforward TS; typecheck catches any signature drift.
```

### Level 2: Unit Tests (the TDD gate)

```bash
# RED phase (Task 1, before the fix): tests (a) and (d) FAIL (gate currently silent); (b)(c) pass.
# GREEN phase (after Task 3): ALL pass.
npx vitest run tests/unit/core/prd-markers.test.ts
# Expected (final): ALL GREEN — 4 new gate-warn tests + the existing stale-warning/marker/idempotency tests.
#   If (a)/(d) still fail, confirm the warn is in neutralizeResolvableTokens (not the main loop) and the
#   condition is !resolves && token.endsWith('.md').
npm run test:run -- prd-resolve
# Expected: GREEN (output bytes unchanged → the BUG-002 idempotency tests + depth tests unaffected).
```

### Level 3: Integration Testing (the gate-warn proof)

```bash
# Smoke: a stale .md at maxDepth=1 emits exactly one stderr warning (real tmpdir).
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const tmp = mkdtempSync(join(tmpdir(), 'bug002-gate-'));
writeFileSync(join(tmp, 'g.md'), 'G @missing.md END');
writeFileSync(join(tmp, 'main.md'), '@g.md');
const warns = []; const orig = console.warn; console.warn = (m) => warns.push(String(m));
import('./src/core/session-utils.ts').then(async m => {
  const out = await m.resolvePRD(join(tmp, 'main.md'), { maxDepth: 1 });
  console.warn = orig;
  console.log('output:', JSON.stringify(out), '| warns:', warns.length, '| msg has missing.md:', warns[0]?.includes('missing.md'));
  rmSync(tmp, { recursive: true, force: true });
});
"
# Expected: output: "G @missing.md END" | warns: 1 | msg has missing.md: true  (verbatim survivor + exactly one gate warning).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# No MCP/DB/HTTP surface. Domain checks (record in commit message):
#   - Stale .md at ANY depth (gate included) emits exactly one stderr warning per pass (PRD §2.3 MUST).
#   - Gate's elided/resolved/non-.md tokens stay silent; verbatim survivor still emitted (output unchanged).
#   - Identical message to the main loop (shared emitStaleIncludeWarning helper — no drift).
#   - No double-warn (gate returns early; token never reaches the main loop).
#   - maxDepth=0 entry edge warns (uniform treatment — entry NOT exempt).
#   - Idempotency preserved (output bytes unchanged; re-resolution re-warns once per pass — spec-correct).
#   - 2 JSDoc spots corrected (neutralizeResolvableTokens L593 + resolvePRD STALE-INCLUDE bullet).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint && npm run format:check` clean.
- [ ] `npm run test:run -- prd-markers prd-resolve` GREEN (4 new gate-warn tests + existing).

### Feature Validation
- [ ] `neutralizeResolvableTokens` warns once for `!resolves && token.endsWith('.md')` (identical message to L553).
- [ ] Gate's elided/resolved/non-`.md` tokens silent; verbatim survivor still emitted (output unchanged).
- [ ] maxDepth=0 entry edge warns (test d).
- [ ] `emitStaleIncludeWarning` shared by main loop + gate (recommended), OR identical inline literal.
- [ ] JSDoc L593 + resolvePRD STALE-INCLUDE bullet (L678-680) corrected (no "depth-exceeded silent" claim).

### Code Quality Validation
- [ ] Only `src/core/session-utils.ts` (warn + helper + main-loop refactor + 2 JSDoc spots) + `tests/unit/core/prd-markers.test.ts` (1 new describe) modified.
- [ ] Output bytes UNCHANGED (verbatim survivor kept); idempotency preserved.
- [ ] No double-warn (gate returns early); no warn for elided/resolved/non-`.md`.
- [ ] Dedup/cycle/diamond/visited-set/marker-constants logic UNCHANGED (T1.S3 owns visited-set; S1 owns constants.ts).

### Documentation & Deployment
- [ ] 2 JSDoc spots corrected (Mode A).
- [ ] Commit message notes: BUG-002 fixed (gate stale-.md warning); identical message via shared helper; output unchanged → idempotency preserved; no double-warn; 2 JSDoc spots corrected; T1.S4 = docs sweep.

---

## Anti-Patterns to Avoid

- ❌ Don't use `replacement === undefined` in the gate — the gate has no `replacement` var; use `!resolves`
      (its boolean). (`replacement === undefined && token.endsWith('.md')` is the MAIN LOOP's condition.)
- ❌ Don't change the warn message — it MUST be byte-identical to L553. Use the shared
      `emitStaleIncludeWarning` helper (recommended) or copy the literal verbatim.
- ❌ Don't remove the verbatim `out += m[0]` — the warn is a SIDE EFFECT; output bytes must NOT change
      (idempotency + hashing/delta-detection depend on it).
- ❌ Don't warn for elided (resolvable), resolved, or non-`.md` tokens — ONLY `!resolves && token.endsWith('.md')`.
- ❌ Don't add a double-warn guard — it's structurally impossible (the gate returns early; the token never
      reaches the main loop).
- ❌ Don't exempt the entry from maxDepth=0 — a stale `.md` in the entry warns (unconditional MUST; test d).
- ❌ Don't "tidy" the (c) test's double-space output (`'G  END'`) — elision drops `@h.md`, leaving the
      surrounding whitespace; that's the correct elision artifact.
- ❌ Don't touch `expandIncludesRecursive`'s dedup/cycle/diamond logic, the visited set (T1.S3 owns the
      realpath-key change), marker emission, or `constants.ts` (S1 owns it).
- ❌ Don't edit the existing L122 stale-warning test (default maxDepth, main loop) — it's unaffected.
- ❌ Don't skip the TDD RED phase — test (a)/(d) must FAIL before the fix, PASS after.
- ❌ Don't run the full `npm run test:run` as the gate — T1.S3's visited-set change may be in flux. Gate on
      `prd-markers prd-resolve` green + lint + format.

---

## Confidence Score

**10/10** — one-pass implementation success likelihood.

Rationale: The fix is a 4-line insertion (a `console.warn` guarded `!resolves && token.endsWith('.md')`)
into a helper (`neutralizeResolvableTokens`) that already computes `token`, `abs`, and `resolves`. The
exact main-loop message to mirror is verified (L553); the recommended `emitStaleIncludeWarning` helper
makes the two sites structurally identical (no drift). The no-double-warn property is proven (the gate
returns early; the token never reaches the main loop). Output bytes are unchanged (the verbatim survivor
is still emitted) → idempotency is preserved, so the BUG-002 idempotency tests + existing stale-warning
tests stay green. The 4 test recipes are traced (a: RED→GREEN; b/c: guards; d: RED→GREEN entry edge).
The two JSDoc before/afters are verbatim. The scope boundary (S1 constants.ts disjoint; T1.S3 visited-set
disjoint; T1.S4 docs separate) is crisp. The only residual risk is a copy-paste typo in the warn message
(caught by test (a)'s `toContain('missing.md')` + the shared-helper recommendation). No external/runtime
unknowns — the Level-3 smoke (gate warns 1×, output verbatim) is deterministic.