# PRP — P1.M3.T1.S1: Implement commit relational check + remove gap comments + tests

> Bugfix 001, **BUG-003 (Minor)**. PRD §9.7.5 specifies `[commit] retry_delay_cap_ms` as
> "int ≥ retry_delay_ms" (the exponential-backoff cap must be at least the base delay), but the
> validation schema (`HACK_CONFIG_SCHEMA`) validates `retry_delay_cap_ms` only as `int >= 0`. So a
> config with `retry_delay_ms = 200000` and `retry_delay_cap_ms = 100` — both individually valid
> integers — is **silently accepted** despite violating the documented relational constraint (verified
> reproduction: `hack config validate` reports "Configuration is valid.", exit 0). The gap is
> acknowledged in two code comments. This item **adds a post-per-key relational check at the END of
> `validateHackTier`** (the single chokepoint both runtime paths funnel through), **removes the two
> "DOCUMENTED GAP" comments**, and **adds 3 unit tests** (cap<delay throws / cap≥delay passes /
> single-key passes). Mode A docs ride with the work (the 2 comment edits in `hack-config.ts`).

---

## Goal

**Feature Goal**: Enforce the PRD §9.7.5 relational constraint `commit.retry_delay_cap_ms ≥
commit.retry_delay_ms` inside `validateHackTier` (the validation function both `hack config validate`
and real startup `loadHackConfig` funnel through), so a per-tier config with a cap below the base
delay is REJECTED as a §9.7.7 hard error at startup / validation time — and remove the two
acknowledging "DOCUMENTED GAP" comments now that the check is enforced.

**Deliverable**:
1. **`src/config/hack-config.ts`** — EDIT `validateHackTier` (insert the cross-key relational check at
   the END of the function, after the section/key loop, before the closing `}`); REMOVE the
   "DOCUMENTED GAP" sentence from the `HACK_CONFIG_SCHEMA` JSDoc (lines 602-603); UPDATE the inline
   comment on the `retry_delay_cap_ms` field spec (line 625).
2. **`tests/unit/config/hack-config.test.ts`** — EDIT: add 3 tests in the
   `describe('hack-config: secrets & validation', …)` block: (a) cap < delay → throws with message
   containing `retry_delay_cap_ms` + `less than`; (b) cap ≥ delay → passes; (c) only one key present
   → passes (relational check does not fire).

**Success Definition**:
- A `.hack` with `[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100` → `loadHackConfig`
  THROWS a `HackConfigError` whose message contains `retry_delay_cap_ms` and `less than`
  `retry_delay_ms` (the values 100 and 200000) and the file path. Both `hack config validate` (CLI)
  and startup reject it.
- A `.hack` with `[commit]\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000` (cap ≥ delay) → loads
  without throwing (the existing full-valid-config test at line 885-913 stays GREEN; a new minimal
  explicit test also passes).
- A `.hack` with `[commit]\nretry_delay_ms = 1000` (only one key) → loads without throwing; the
  relational check is skipped (it only fires when BOTH keys are present).
- The two "DOCUMENTED GAP" comments are gone/updated; the code no longer claims the gap is deferred.
- `npm run typecheck && npm run lint && npm run format:check` clean; the targeted test file is GREEN
  (existing + 3 new).

---

## Why

- **BUG-003: the relational constraint is documented but unenforced.** PRD §9.7.5 lists
  `retry_delay_cap_ms` as "int ≥ retry_delay_ms" — a cross-key range that the per-key schema
  (`{ type:'int', min:0 }`) cannot express. Today a cap below the base delay is silently accepted
  (the cap merely prevents the exponential doubling from ever applying — low impact, but it deviates
  from the spec table and §9.7.7 frames range mismatches as hard startup errors).
- **`validateHackTier` is the single chokepoint.** Both runtime paths funnel through it: (1)
  `hack config validate` CLI calls `validateHackTier` per file; (2) real startup `loadHackConfig`
  calls `validateHackTier` per tier (hack-config.ts:952). A check here is the ONE edit that fixes BOTH
  paths — putting it in `loadHackConfig` would leave the `validate` CLI accepting the bad config.
- **Per-tier is the correct scope.** `validateHackTier` validates per-file; cross-tier (delay in
  `.hack`, cap in `.hack.local`) is a KNOWN, ACCEPTED limitation — the bug's reproduction is
  single-file, PRD §9.7.7 frames validation as per-file, the `validate` CLI lints files independently
  by design, and the defaults (10000 / 120000) satisfy the constraint. The check only fires when BOTH
  keys are present in THIS tier.
- **Rides on BUG-002 for clean rendering.** Using `HackConfigError` (P1.M2.T1.S1 = Complete; imported
  at hack-config.ts:12, already used at the 9 throw sites) means the relational throw renders via the
  dedicated clean `main().catch()` arm (P1.M2.T2.S1) — a single `❌ <message>` line, no stack trace.
  Free win; the message is what matters for the constraint.
- **Docs accuracy (Mode A).** The two "DOCUMENTED GAP" comments are now FALSE — the check is
  enforced. Leaving them would mislead future readers. Removing/updating them rides with the work.
- **Scope discipline.** This item edits ONLY `hack-config.ts` (validateHackTier body + 2 comments) +
  its test file. It does NOT touch `validateFieldValue`, `loadHackConfig`, the schema field specs
  (beyond the comment), the `hack config validate` CLI, any other source file, or the external
  `docs/*.md` sweep (that is P1.M3.T2.S1). Disjoint from the parallel P1.M2.T2.S2
  (`tests/integration/config-error-rendering.test.ts`).

---

## What

### User-visible behavior
A `.hack` whose `[commit]` section sets `retry_delay_cap_ms` below `retry_delay_ms` now fails at
startup with a clear actionable error naming the file, both values, and the constraint — instead of
being silently accepted. `hack config validate` now reports the violation (exit non-zero) instead of
"Configuration is valid." A config satisfying the constraint (or omitting one of the keys) is
unaffected.

### Technical requirements (exact contract — VERBATIM from architecture/bug_003_fix_strategy.md)

**(1) `validateHackTier` relational check** — INSERT between line 796 (the outer section-loop's
closing `}`) and line 797 (the function's closing `}`). Indented 2 spaces (function-body level),
sibling of the `for` loop:

```ts
  // ── Cross-key relational check (PRD §9.7.5: commit.retry_delay_cap_ms ≥ retry_delay_ms) ──
  // Both keys are individually valid (per-key type/range checks ran in the loop above); verify
  // their relationship. Only fires when BOTH keys are present in THIS tier (a single-key tier is
  // always valid). Per-tier (per-file) — cross-tier (delay in .hack, cap in .hack.local) is a
  // KNOWN, ACCEPTED limitation (PRD §9.7.7 frames validation as per-file; defaults satisfy it).
  const commit = parsed.commit;
  if (
    commit &&
    commit.retry_delay_ms !== undefined &&
    commit.retry_delay_cap_ms !== undefined
  ) {
    const delay = commit.retry_delay_ms as number;
    const cap = commit.retry_delay_cap_ms as number;
    if (cap < delay) {
      throw new HackConfigError(
        `[commit] retry_delay_cap_ms in ${file}: ${cap} is less than retry_delay_ms (${delay}); the cap must be ≥ the base delay.`
      );
    }
  }
```

**Boundary proof** (verified via `awk` on HEAD):
```
794:      validateFieldValue(file, section, key, value, spec);
795:    }              ← closes the INNER for loop (over keys)
796:  }                ← closes the OUTER for loop (over sections)
<INSERT HERE>          ← the relational block
797:}                  ← closes validateHackTier
```

**(2) Remove the "DOCUMENTED GAP" JSDoc sentence** (hack-config.ts:602-603). The current text in the
`HACK_CONFIG_SCHEMA` `@remarks`:
```
 *
 * The relational `commit.retry_delay_cap_ms >= commit.retry_delay_ms` cross-key check is a
 * DOCUMENTED GAP (P2.M2 may harden); `retry_delay_cap_ms` validates as `int >= 0` only.
 */
```
**Action: delete the blank ` *` line + the entire "The relational … only." sentence.** The preceding
`@remarks` text (about `[auth]`, secrets policy §9.7.6, no overlap with S2/P2.M2.T1.S1) stays intact;
the `*/` now closes directly after it. (Optionally append a one-line replacement: `* The relational
commit.retry_delay_cap_ms >= commit.retry_delay_ms cross-key check is enforced in validateHackTier.` —
acceptable, but removal alone satisfies the contract.)

**(3) Update the inline comment** (hack-config.ts:625). Current:
```ts
    retry_delay_cap_ms: { type: 'int', min: 0 }, // relational cap>=delay deferred (cross-key)
```
Change the trailing comment to:
```ts
    retry_delay_cap_ms: { type: 'int', min: 0 }, // relational cap>=delay enforced in validateHackTier
```

**Tests** (`tests/unit/config/hack-config.test.ts`) — add in the
`describe('hack-config: secrets & validation', …)` block (line 577), in (or right after) the
"// --- Type / range / enum (§9.7.7) — HARD errors ---" sub-section. See Implementation Tasks.

### Success Criteria
- [ ] `validateHackTier` contains the relational check block after the section/key loop, before the
      function's closing `}`.
- [ ] `cap < delay` → throws `HackConfigError`; message has `retry_delay_cap_ms`, `less than`,
      `retry_delay_ms`, the offending values, and the file path.
- [ ] `cap ≥ delay` (both keys present) → no throw (existing test 885-913 + new explicit test pass).
- [ ] Only one of the two keys present → no throw (relational check skipped).
- [ ] No `[commit]` section → no throw (outer `if` false; covered by every commit-less test).
- [ ] The "DOCUMENTED GAP" JSDoc sentence (602-603) is removed; the inline comment (625) is updated.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean; targeted test file GREEN.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the
verbatim relational block, the exact insertion site (between line 796 and 797, verified via `awk`), the
exact text of both gap comments to remove/update, the verbatim range-error test to mirror (line
748-758), the test harness already set up in the describe block (`dir`/`warnSpy`/`beforeEach`), the
three test cases with their `.hack` content + assertions, the proof that `HackConfigError` is already
imported + used (P1.M2.T1.S1 Complete), the per-tier design rationale + the accepted cross-tier
limitation, and the npm gate. See `research/relational-check-strategy.md` for per-claim evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative fix strategy (the relational block + design rationale are prescribed)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/architecture/bug_003_fix_strategy.md
  section: "Fix: Post-Per-Key Relational Check in validateHackTier" (+ "Why validateHackTier", "Error Message Style", "Remove the DOCUMENTED GAP Comments", "Cross-Tier Limitation", "Existing Tests (Pass Case)")
  why: Prescribes the EXACT relational block, the validateHackTier-not-loadHackConfig placement, the message style, the comment removals, the per-tier design + the accepted cross-tier limitation, and the existing pass-case test.
  critical: The block is specified verbatim; the message uses '≥' (unicode). Use HackConfigError (already imported) so it renders cleanly via the BUG-002 arm.

# MUST READ — PRD §9.7.5 / §9.7.7 (the contract this enforces)
- file: PRD.md
  section: "9.7.5" (schema reference: [commit] retry_delay_cap_ms = "int ≥ retry_delay_ms") + "9.7.7" (type/range mismatches are hard errors that must abort at startup)
  why: The relational range is part of the §9.7.5 schema; §9.7.7 frames range mismatches as hard startup errors.
  critical: per-file (per-tier) validation framing → the cross-tier limitation is acceptable.

# THIS SUBTASK'S RESEARCH (insertion site + exact comment text + test pattern + branches)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M3T1S1/research/relational-check-strategy.md
  section: "1. Architecture contract", "2. Exact insertion site", "3. The two gap comments", "4. Type model (as number safe)", "5. Test pattern", "6. The three test cases", "7. HackConfigError + rendering", "8. Disjointness"
  why: The awk-verified line boundaries (794/795/796/797); the verbatim text of both gap comments; why the `as number` cast is safe (the per-key loop already int-validated both keys); the range-error test to mirror; the 3 branches + their test coverage; the HackConfigError-already-imported fact.

# THE FILE TO EDIT
- file: src/config/hack-config.ts
  why: EDIT validateHackTier (755-797) — insert the relational block between line 796 and 797. REMOVE the DOCUMENTED-GAP JSDoc sentence (602-603). UPDATE the inline comment (625).
  pattern_validateHackTier: "export function validateHackTier(parsed, file, tier): void { for (const [section, keys] of Object.entries(parsed)) { … for (const [key, value] of Object.entries(keys)) { … validateFieldValue(file, section, key, value, spec); } } /* INSERT RELATIONAL BLOCK HERE */ }"
  pattern_commit_schema: "commit: { retry_max: { type:'int', min:1 }, retry_delay_ms: { type:'int', min:0 }, retry_delay_cap_ms: { type:'int', min:0 }, classifier_retry_max: { type:'int', min:1 } }"
  critical: HackConfigError is ALREADY imported at line 12 (`import { HackConfigError } from './types.js'`) and used at the 9 throw sites (P1.M2.T1.S1 Complete). Use it directly. The `as number` cast is safe because the per-key loop already int-validated both keys before this block runs.

# THE TYPE MODEL (read-only — confirms parsed.commit + the as-number cast compile)
- file: src/config/hack-config.ts
  why: ParsedHackConfig (line 35) = { [section:string]: { [key:string]: HackConfigValue } }. parsed.commit → { [key:string]: HackConfigValue } (or |undefined if noUncheckedIndexedAccess; the `commit &&` guard covers both). commit.retry_delay_ms !== undefined narrows; `as number` casts HackConfigValue→number (valid: number is a union member).
  gotcha: TS may warn "condition always truthy" on `commit &&` if noUncheckedIndexedAccess is OFF (parsed.commit typed as always-defined). That is NOT an error — keep the guard for runtime safety (absent section → undefined at runtime even if TS doesn't model it).

# THE ERROR CLASS (read-only — P1.M2.T1.S1 owns it; already imported)
- file: src/config/types.ts
  why: HackConfigError (extends Error). Using it makes the relational throw render via the dedicated clean main().catch() arm (P1.M2.T2.S1). Do NOT edit.

# THE TEST FILE TO EDIT + the verbatim model for the throw case
- file: tests/unit/config/hack-config.test.ts
  why: EDIT — add 3 tests in describe('hack-config: secrets & validation', …) (line 577). The range-error test (748-758) is the EXACT model for case (a). The full-valid-config test (885-913) is the regression guard for case (b) (uses retry_delay_ms=1000, retry_delay_cap_ms=10000).
  pattern_throw_case: "vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-<x>')); const repoRoot = mkdtempSync(join(dir, 'repo-<x>-')); const hackFile = join(repoRoot, '.hack'); writeFileSync(hackFile, '…'); expect(() => loadHackConfig(repoRoot)).toThrow(/<sub>/); expect(() => loadHackConfig(repoRoot)).toThrow(/<sub2>/); expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);"
  critical: The describe block's beforeEach already sets up `dir` + `warnSpy` + deletes env keys — REUSE them (do not re-declare). Mirror the range test's SETUP/EXECUTE/VERIFY comment discipline. case (a) uses retry_delay_ms=200000 + retry_delay_cap_ms=100 (the bug's exact reproduction).

# CONSUMERS (read-only — proves the single-edit-fixes-both-paths claim + non-breaking)
- file: src/config/hack-config.ts (loadHackConfig, ~949-953)
  why: loadHackConfig calls validateHackTier(parsed, file, tier) per tier (line 952) → the relational check fires on real startup. READ-ONLY — do NOT edit loadHackConfig.
- file: src/cli/index.ts (or src/cli/config.ts)
  why: `hack config validate` calls validateHackTier per file → the relational check fires on the validate CLI too. READ-ONLY.

# PARALLEL-SIBLING CONTRACT (disjoint — no conflict)
- docfile: plan/009_94353b1a9fd3/bugfix/001_412283d974f7/P1M2T2S2/PRP.md
  why: In flight in parallel. Creates tests/integration/config-error-rendering.test.ts (subprocess rendering tests). This item edits src/config/hack-config.ts + tests/unit/config/hack-config.test.ts — ZERO file overlap. The relational throw WILL render cleanly because it uses HackConfigError (consumes P1.M2.T1.S1 + P1.M2.T2.S1) — a free win, no coordination needed.

# COVERAGE CONFIG
- file: vitest.config.ts
  why: This project's coverage thresholds are a FLOOR (~89 statements / 90 branches), NOT 100% (per P1.M2.T2.S2 research §4). The new relational branches (outer-if true/false, inner-if true/false) are covered by the 3 tests regardless. No new src FILE is added (an edit to an existing file) → coverage measured on the modified function only.
```

### Current Codebase tree (relevant slice)
```bash
src/config/hack-config.ts                       # EDIT — validateHackTier relational check + 2 comment edits
src/config/types.ts                             # READ-ONLY (HackConfigError; already imported)
tests/unit/config/hack-config.test.ts           # EDIT — +3 relational tests in the secrets & validation describe block
```

### Desired Codebase tree with files to be added/edited
```bash
src/config/hack-config.ts                       # MODIFIED (validateHackTier body + JSDoc 602-603 + inline comment 625)
tests/unit/config/hack-config.test.ts           # MODIFIED (+3 tests: cap<delay throws / cap≥delay passes / single-key passes)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — Insert BETWEEN line 796 (outer section-loop `}`) and line 797 (validateHackTier `}`).
//   NOT inside the loop, NOT in loadHackConfig, NOT in validateFieldValue. The check must run AFTER
//   the per-key loop (so both keys are already int-validated) and BEFORE the function returns.
//   Verified via `awk 'NR>=794 && NR<=808'` (research §2).

// CRITICAL — Use HackConfigError (NOT plain Error). It is ALREADY imported at hack-config.ts:12 and
//   already used at the 9 throw sites (P1.M2.T1.S1 = Complete). Using it makes the relational throw
//   render via the BUG-002 clean arm. The item's "plain Error works" fallback is moot — use HackConfigError.

// CRITICAL — The `as number` cast is SAFE but ONLY because the per-key loop ran first. By the time
//   the relational check executes, both keys (known keys in a known section) have passed
//   validateFieldValue's `int` type check → they are JS numbers. Do NOT remove the `!== undefined`
//   guards — they're what makes the cast sound (and required if noUncheckedIndexedAccess is on).

// CRITICAL — The check is PER-TIER (per-file). It only fires when BOTH keys are present in THIS tier.
//   Cross-tier (delay in .hack, cap in .hack.local) is a KNOWN, ACCEPTED limitation — do NOT try to
//   fix it here (would require a cross-tier merge-then-validate redesign; out of scope). Document it
//   in the inline comment (already in the prescribed block).

// GOTCHA — `parsed.commit` may be `undefined` at runtime (section absent) even though TS's index
//   signature types it as always-defined. The `commit &&` guard handles both runtime + (if enabled)
//   noUncheckedIndexedAccess. Keep it. TS may emit a "condition always truthy" lint HINT if the flag
//   is off — that is NOT an error; suppress only if eslint fails (it won't — it's a hint, not a rule).

// GOTCHA — The message uses '≥' (unicode U+2265) in the remediation suffix, matching the architecture
//   spec + PRD §9.7.5 verbatim. The test assertions check ASCII substrings ('retry_delay_cap_ms',
//   'less than', 'retry_delay_ms') — do NOT assert on '≥' (encoding-fragile). The values 100 and
//   200000 ARE in the message via template literals — assert on them for a tight check.

// GOTCHA — vitest coverage for THIS project is a FLOOR (~89/90), not 100%. But cover ALL branches
//   anyway (3 tests → outer-if true(b,a) / false(c) + inner-if true(a) / false(b)). A missing branch
//   is a latent gap even under a floor threshold if the modified function's branch coverage dips.

// GOTCHA — prettier is ERROR-enforced (format:check). The multi-line relational block + the edited
//   JSDoc may reflow; run `npm run fix` (lint:fix + prettier --write) BEFORE format:check.

// GOTCHA — Do NOT run the full `npm run test:run` as the gate (orthogonal pre-existing failures per
//   the bugfix architecture docs). Gate = typecheck + lint + format:check + the TARGETED
//   tests/unit/config/hack-config.test.ts.

// CRITICAL — DO NOT touch validateFieldValue, loadHackConfig, the HACK_CONFIG_SCHEMA field specs
//   (beyond the line-625 COMMENT), the hack config validate CLI, src/config/types.ts, any other test
//   file, or any external docs/*.md (the docs sweep is P1.M3.T2.S1; THIS item's Mode A docs are the
//   2 inline edits in hack-config.ts only).
```

---

## Implementation Blueprint

### Data models and structure
No new data models. This item consumes `ParsedHackConfig` (hack-config.ts:35), `HackConfigValue`, and
`HackConfigError` (types.ts). The only "structure" is the relational check block (verbatim above), the
two comment edits, and the 3 tests.

### Implementation Tasks (ordered by dependencies — TDD: RED first, then GREEN)
```yaml
Task 1: EDIT tests/unit/config/hack-config.test.ts  (RED — add the 3 failing tests FIRST)
  - LOCATE describe('hack-config: secrets & validation', …) (line 577). Its beforeEach already sets
    up `dir` (mkdtempSync), `warnSpy`, and deletes PRP_API_KEY/HACKY_LOG_LEVEL — REUSE them.
  - ADD a new sub-section comment "// --- Relational cross-key (§9.7.5: commit.retry_delay_cap_ms ≥
    retry_delay_ms) ---" right after the "Type / range / enum (§9.7.7)" sub-section (after the last
    range/enum test, ~line 826).
  - ADD case (a) — MIRROR the range test (748-758) verbatim:
      it('SHOULD throw when [commit] retry_delay_cap_ms < retry_delay_ms (§9.7.5 relational)', () => {
        // SETUP — cap (100) below base delay (200000): both individually valid ints, but cap < delay.
        vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-throws'));
        const repoRoot = mkdtempSync(join(dir, 'repo-rel-throws-'));
        const hackFile = join(repoRoot, '.hack');
        writeFileSync(hackFile, '[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n');
        // EXECUTE & VERIFY — throws naming section + key + file + both values + 'less than'.
        expect(() => loadHackConfig(repoRoot)).toThrow(/retry_delay_cap_ms/);
        expect(() => loadHackConfig(repoRoot)).toThrow(/less than/);
        expect(() => loadHackConfig(repoRoot)).toThrow(/retry_delay_ms/);
        expect(() => loadHackConfig(repoRoot)).toThrow(hackFile);
        expect(() => loadHackConfig(repoRoot)).toThrow(/200000/);
        expect(() => loadHackConfig(repoRoot)).toThrow(/100/);
      });
  - ADD case (b) — explicit minimal cap≥delay pass (the existing 885-913 test is the primary guard):
      it('SHOULD accept [commit] retry_delay_cap_ms ≥ retry_delay_ms (§9.7.5 relational satisfied)', () => {
        vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-ok'));
        const repoRoot = mkdtempSync(join(dir, 'repo-rel-ok-'));
        const hackFile = join(repoRoot, '.hack');
        writeFileSync(hackFile, '[commit]\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000\n');
        // EXECUTE & VERIFY — no throw; the commit values merged through.
        expect(() => loadHackConfig(repoRoot)).not.toThrow();
      });
  - ADD case (c) — single key present → no relational check fires:
      it('SHOULD NOT fire the relational check when only one of the two [commit] keys is present', () => {
        vi.stubEnv('HACK_CONFIG_HOME', join(dir, 'no-global-rel-one'));
        const repoRoot = mkdtempSync(join(dir, 'repo-rel-one-'));
        const hackFile = join(repoRoot, '.hack');
        writeFileSync(hackFile, '[commit]\nretry_delay_ms = 1000\n'); // cap omitted
        // EXECUTE & VERIFY — no throw (relational check requires BOTH keys).
        expect(() => loadHackConfig(repoRoot)).not.toThrow();
      });
  - EXPECTED NOW: case (a) FAILS (no relational check yet → loadHackConfig resolves, the toThrow
    assertions fail). Cases (b)/(c) PASS trivially (no throw today either). → RED on (a).

Task 2: EDIT src/config/hack-config.ts  (GREEN — the relational check)
  - INSERT the relational block (verbatim from "Technical requirements") between line 796 (the outer
    section-loop's closing `}`) and line 797 (the validateHackTier closing `}`). 2-space indent,
    sibling of the `for` loop.
  - DO NOT: place it inside the loop; remove the `commit &&` or `!== undefined` guards; drop the
    `as number` casts; use plain Error; add a cross-tier check; touch validateFieldValue/loadHackConfig/
    the schema field specs; edit any other file.
  - EXPECTED: Task 1 case (a) turns GREEN; cases (b)/(c) stay GREEN.

Task 3: EDIT src/config/hack-config.ts  (Mode A docs — remove/update the 2 gap comments)
  - REMOVE the blank ` *` line + the entire "The relational `commit.retry_delay_cap_ms >=
    commit.retry_delay_ms` cross-key check is a DOCUMENTED GAP (P2.M2 may harden);
    `retry_delay_cap_ms` validates as `int >= 0` only." sentence from the HACK_CONFIG_SCHEMA @remarks
    (lines 602-603). The preceding @remarks text + the `*/` stay. (Optional: append a one-line
    replacement noting the check is now enforced in validateHackTier — acceptable.)
  - UPDATE the inline comment on line 625 from
    `// relational cap>=delay deferred (cross-key)` to
    `// relational cap>=delay enforced in validateHackTier`.
  - EXPECTED: no behavior change; typecheck/format pass.

Task 4: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/config/hack-config.test.ts   # existing + 3 new relational tests → GREEN.
  - DO NOT run the full `npm run test:run` (orthogonal pre-existing failures per bugfix docs).
  - EXPECTED: typecheck/lint/format clean; the targeted file GREEN (incl. the existing range/enum
    tests, the existing full-valid-config test 885-913, and the 3 new relational tests).
    If case (a) fails → the relational block isn't placed after the loop / the guard conditions are
    wrong / HackConfigError isn't the thrown type. If the existing range test fails → the insertion
    broke the loop (placed INSIDE it?). If typecheck fails → `as number` cast on a non-number, or
    `parsed.commit` access issue (re-check the ParsedHackConfig index signature).
```

### Implementation Patterns & Key Details
```ts
// ---- src/config/hack-config.ts: the relational block (insert after line 796, before 797) ----
  // ── Cross-key relational check (PRD §9.7.5: commit.retry_delay_cap_ms ≥ retry_delay_ms) ──
  // Both keys are individually valid (per-key type/range checks ran in the loop above); verify
  // their relationship. Only fires when BOTH keys are present in THIS tier (a single-key tier is
  // always valid). Per-tier (per-file) — cross-tier is a KNOWN, ACCEPTED limitation.
  const commit = parsed.commit;
  if (
    commit &&
    commit.retry_delay_ms !== undefined &&
    commit.retry_delay_cap_ms !== undefined
  ) {
    const delay = commit.retry_delay_ms as number;
    const cap = commit.retry_delay_cap_ms as number;
    if (cap < delay) {
      throw new HackConfigError(
        `[commit] retry_delay_cap_ms in ${file}: ${cap} is less than retry_delay_ms (${delay}); the cap must be ≥ the base delay.`
      );
    }
  }

// ---- the gap-comment edits ----
// (602-603) DELETE the blank ' *' line + the 'The relational … only.' sentence from @remarks.
// (625)    'retry_delay_cap_ms: { type: "int", min: 0 }, // relational cap>=delay enforced in validateHackTier'

// ---- the 3 tests (mirror the range test at line 748-758) ----
// (a) '[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n' → toThrow(/retry_delay_cap_ms/) + /less than/ + /retry_delay_ms/ + hackFile + /200000/ + /100/
// (b) '[commit]\nretry_delay_ms = 1000\nretry_delay_cap_ms = 10000\n' → not.toThrow()
// (c) '[commit]\nretry_delay_ms = 1000\n' (cap omitted) → not.toThrow()
```

### Integration Points
```yaml
HACK-CONFIG.TS (src/config/hack-config.ts):
  - validateHackTier (755-797): +relational block after the section/key loop, before the function `}`.
  - HACK_CONFIG_SCHEMA @remarks (602-603): -DOCUMENTED GAP sentence.
  - commit.retry_delay_cap_ms inline comment (625): 'deferred (cross-key)' → 'enforced in validateHackTier'.
  - PRESERVE: validateFieldValue, loadHackConfig, the schema field specs (only the 625 COMMENT changes),
    the secrets/unknown-section/unknown-key logic, the 9 existing throw sites.

TEST (tests/unit/config/hack-config.test.ts):
  - +3 tests in describe('hack-config: secrets & validation') after the type/range/enum sub-section.
  - PRESERVE: the existing range/enum/type tests (748-826), the full-valid-config test (885-913),
    the describe block's beforeEach harness (dir/warnSpy/env-deletes).

CONSUMERS (read-only — the single-edit-fixes-both-paths proof):
  - loadHackConfig (hack-config.ts:952) calls validateHackTier per tier → startup rejects cap<delay.
  - `hack config validate` CLI calls validateHackTier per file → validate CLI rejects cap<delay.

RENDERING (free win — consumes BUG-002):
  - The relational throw uses HackConfigError → renders via the dedicated clean main().catch() arm
    (P1.M2.T2.S1). No coordination needed; the message is what matters.

OUT OF SCOPE (hard boundary):
  - validateFieldValue, loadHackConfig body, HACK_CONFIG_SCHEMA field specs (beyond the 625 comment),
    src/config/types.ts, the hack config validate CLI, any other source file.
  - Cross-tier relational checking (KNOWN, ACCEPTED limitation — per-tier only).
  - The external docs/*.md sweep (README, CONFIGURATION.md, CLI_REFERENCE, ARCHITECTURE.md) — that is
    P1.M3.T2.S1. THIS item's Mode A docs are the 2 inline edits in hack-config.ts ONLY.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (run first — the block + JSDoc may reflow)
npm run typecheck      # tsc --noEmit -p tsconfig.build.json — clean
npm run lint           # eslint . --ext .ts — clean
npm run format:check   # prettier --check — clean
# Expected: all clean. Likely failure: a type error if the `as number` cast or parsed.commit access is
#   wrong (re-check ParsedHackConfig index signature at line 35); or a prettier nit (re-run `npm run fix`).
```

### Level 2: Unit Tests (Component Validation)
```bash
# The directly-affected suite — MUST be GREEN (existing + 3 new relational tests):
npx vitest run tests/unit/config/hack-config.test.ts
# Expected: all green. If case (a) fails (no throw) → the relational block isn't after the loop / the
#   guards are wrong / not using HackConfigError. If the existing range/enum tests fail → the insertion
#   broke the per-key loop (placed INSIDE it?). If the full-valid-config test (885-913) fails → the
#   relational check is firing on a valid cap≥delay config (guard condition inverted?).
# Do NOT run the full `npm run test:run` (orthogonal pre-existing failures per bugfix docs).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the relational block + the comment edits landed:
grep -n "Cross-key relational check (PRD §9.7.5" src/config/hack-config.ts   # 1 hit (the block banner)
grep -n "is less than retry_delay_ms" src/config/hack-config.ts              # 1 hit (the throw message)
grep -n "DOCUMENTED GAP" src/config/hack-config.ts                           # 0 hits (removed)
grep -n "deferred (cross-key)" src/config/hack-config.ts                     # 0 hits (updated)
grep -n "enforced in validateHackTier" src/config/hack-config.ts             # ≥1 hit (the updated inline comment; optional 2nd if the JSDoc replacement line was added)
# Confirm the block is INSIDE validateHackTier (after the loop, before the function close) — not in loadHackConfig:
grep -n "function validateHackTier" src/config/hack-config.ts                # the function start; the block is between its loop and its closing brace
# Build emits dist/ cleanly:
npx tsc -p tsconfig.build.json
# Expected: grep returns the expected hit counts (DOCUMENTED GAP + 'deferred (cross-key)' = 0); build clean.
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP (pure config validation). Manual reproduction (record in commit message):
#   1. In a real git repo, write .hack with '[commit]\nretry_delay_ms = 200000\nretry_delay_cap_ms = 100\n'.
#   2. `hack config validate` now EXITS NON-ZERO with the relational error (was: "Configuration is valid.", exit 0).
#   3. `hack --dry-run` now fails at startup with the clean ❌ line (was: silently accepted) — via the
#      HackConfigError arm (BUG-002), a single actionable message, no stack trace.
#   4. A valid config (cap≥delay, e.g. 1000/10000) or a single-key config loads unchanged.
# Domain reasoning:
#   5. The check is PER-TIER (per-file) — cross-tier (delay in .hack, cap in .hack.local) is a KNOWN,
#      ACCEPTED limitation (PRD §9.7.7 per-file framing; defaults 10000/120000 satisfy it).
#   6. The `as number` cast is sound: the per-key loop already int-validated both keys before this block.
#   7. Single-edit-fixes-both-paths: validateHackTier is the chokepoint for both `hack config validate`
#      and `loadHackConfig` startup.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/config/hack-config.test.ts` GREEN (existing + 3 new relational tests).

### Feature Validation
- [ ] `cap < delay` (200000/100) → throws `HackConfigError`; msg has `retry_delay_cap_ms`, `less than`,
      `retry_delay_ms`, both values, and the file path.
- [ ] `cap ≥ delay` (1000/10000) → no throw (new explicit test + existing 885-913 test).
- [ ] Single key present → no throw (relational check skipped).
- [ ] Both `hack config validate` (CLI) and `loadHackConfig` (startup) reject cap < delay (via the
      shared `validateHackTier` chokepoint).

### Code Quality Validation
- [ ] The relational block is after the section/key loop, before validateHackTier's closing `}`.
- [ ] Uses `HackConfigError` (clean rendering via BUG-002 arm); `as number` cast guarded by `!== undefined`.
- [ ] Per-tier scope documented inline (cross-tier limitation acknowledged).
- [ ] Only `src/config/hack-config.ts` + `tests/unit/config/hack-config.test.ts` modified.
- [ ] Existing range/enum/type tests + the full-valid-config test stay GREEN.

### Documentation & Deployment
- [ ] Mode A: the "DOCUMENTED GAP" JSDoc sentence (602-603) removed; the inline comment (625) updated.
- [ ] No external `docs/*.md` changes (the docs sweep is P1.M3.T2.S1).
- [ ] Commit message records: BUG-003; the validateHackTier-chokepoint design (single edit fixes both
      paths); the per-tier scope + the accepted cross-tier limitation; the `as number`-is-safe rationale
      (per-key loop already int-validated); the HackConfigError choice (rides on BUG-002 clean rendering);
      the 3 test cases; the 2 comment edits.

---

## Anti-Patterns to Avoid

- ❌ Don't put the check in `loadHackConfig` (or `validateFieldValue`). `loadHackConfig` would leave
      the `hack config validate` CLI accepting the bad config. `validateHackTier` is the ONE chokepoint
      both paths funnel through — that's the whole reason for the placement.
- ❌ Don't place the block INSIDE the section/key loop, or before it. It must run AFTER the loop (so
      both keys are already int-validated) and BEFORE the function returns. Insert between line 796
      and 797.
- ❌ Don't use plain `Error`. `HackConfigError` is already imported (line 12) + used at the 9 throw
      sites (P1.M2.T1.S1 Complete). Using it makes the throw render via the BUG-002 clean arm for free.
- ❌ Don't drop the `commit &&` or `!== undefined` guards. They make the `as number` cast sound (the
      keys may be undefined at runtime) and handle noUncheckedIndexedAccess if enabled. TS may emit a
      "condition always truthy" HINT on `commit &&` if the flag is off — that's a hint, not an error.
- ❌ Don't assert on `≥` (unicode) in the tests — encoding-fragile. Assert on ASCII substrings
      (`retry_delay_cap_ms`, `less than`, `retry_delay_ms`) + the numeric values (100, 200000) + the
      file path. The values are interpolated into the message via template literals → safe to assert.
- ❌ Don't try to fix the cross-tier limitation (delay in `.hack`, cap in `.hack.local`). It is a
      KNOWN, ACCEPTED per-tier scope (PRD §9.7.7 per-file framing; defaults satisfy it). A cross-tier
      fix would require a merge-then-validate redesign — far out of scope.
- ❌ Don't edit `validateFieldValue`, `loadHackConfig` body, the `HACK_CONFIG_SCHEMA` field specs
      (beyond the line-625 COMMENT), `src/config/types.ts`, the `hack config validate` CLI, any other
      test file, or any external `docs/*.md` (the docs sweep is P1.M3.T2.S1; Mode A here = the 2 inline
      edits in hack-config.ts only).
- ❌ Don't re-declare `dir`/`warnSpy` in the new tests — the `describe('hack-config: secrets &
      validation')` `beforeEach` (line 577+) already sets them up. Just write the 3 `it` blocks.
- ❌ Don't run the full `npm run test:run` as the gate (orthogonal pre-existing failures per the bugfix
      docs). Gate = typecheck + lint + format:check + the targeted `tests/unit/config/hack-config.test.ts`.
- ❌ Don't forget to remove BOTH gap comments. The JSDoc sentence (602-603) AND the inline comment
      (625). Leaving either claims the gap is still deferred → docs lie.

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, fully-specified, additive validation slice. The relational check block is
prescribed **verbatim** by the architecture doc (`architecture/bug_003_fix_strategy.md`) and repeated
in the item description; the insertion site is verified against HEAD (`awk` on lines 794-808 → insert
between 796 and 797); `HackConfigError` is already imported + used (P1.M2.T1.S1 Complete — no
dependency risk); the two gap comments' exact text is quoted for precise removal/update; the
range-error test (748-758) is a copy-ready model for case (a); the describe block's `beforeEach`
harness is already set up (`dir`/`warnSpy`); and all 3 branches of the new code are covered by the 3
tests. The non-obvious facts are documented with proof: (1) `validateHackTier`-not-`loadHackConfig`
(single chokepoint for both paths); (2) per-tier scope + the accepted cross-tier limitation; (3) the
`as number` cast is safe because the per-key loop already int-validated both keys; (4) the message uses
`≥` (unicode) → assert on ASCII substrings + values, not on `≥`; (5) coverage is a floor (~89/90) for
this project but all branches are covered regardless. The work is file-disjoint from the parallel
P1.M2.T2.S2 (`tests/integration/config-error-rendering.test.ts`) and from P1.M3.T2.S1 (the external
docs sweep). Residual risks: (a) a prettier reflow of the block/JSDoc (auto-fixed via `npm run fix`);
(b) a noUncheckedIndexedAccess "condition always truthy" HINT on `commit &&` (a hint, not an error —
keep the guard); (c) asserting on the wrong substring (mitigated: the message substrings + numeric
values are quoted). No runtime/network/LLM unknowns — pure config validation + in-process unit tests.