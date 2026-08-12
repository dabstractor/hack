# PRP — P1.M3.T2.S1: Fix stray-`>` blocker + assert trailer/banner absence in all modes

> §9.10 "Commit Generation & Agent Tool Safety" — **M3.T2.S1 (behavioral-test inversion + the stray-`>`
> blocker)**. PRD §9.10.2 requires `formatCommitMessage` to assert **ABSENCE** (not presence) of
> `Co-Authored-By` / `noreply@anthropic.com` / `[PRP Auto]` across **every mode** (task-prefix, plain,
> null-position, [PRP Auto]-strip), and §5.1's "unless an explicit style layer below adds one" carve-out is
> removed (no style layer may add a `Co-Authored-By` trailer, ever). **⚠️ CONTRACT RECONCILIATION (critical):**
> the work item's research note cites `commit-tests-survey.md §1/§3`, which predates the parallel
> **P1.M2.T3.S2** rewire (COMPLETE). That rewire already **resolved the stray-`>` blocker AND the Co-Authored-By
> inversion** in `git-commit.test.ts` (rewritten 2233 → 2621 lines; mock target moved from the deleted
> `commit-message-agent` factory to the stagecoach binary-exec boundary). **Live verification (this PRP's
> research):** `grep ">'[\),]" tests/unit/utils/git-commit.test.ts` = **0 hits**; no `noreply`/`Co-Authored`
> PRESENCE assertion survives; the §5.1 carve-out phrase is **absent from src/** entirely. So clauses (a),
> (c), (d) of the contract are **ALREADY DONE → verify only**. The **REAL remaining work** is small: (b) the
> §9.10.2 "every mode × full triple" coverage has a **plain-mode gap**; (DOCS) the `formatCommitMessage` JSDoc
> cites §5.1 but **not §9.10.2**; and two **stale test titles** still say `+ trailer` (the trailer was removed).
> This PRP prescribes exactly that — verify the done parts, complete the gaps. The architecture survey
> (`commit-tests-survey.md §1/§3`) + the live tree are the contract; this PRP fuses them so the implementer
> does not re-rewire already-correct code.

---

## Goal

**Feature Goal**: Make `tests/unit/utils/git-commit.test.ts` and `tests/integration/smart-commit.test.ts`
fully satisfy PRD §9.10.2's behavioral-test requirement — `formatCommitMessage` asserts trailer/banner
**absence** across **all four** modes (task-prefix, plain (`PRP_COMMIT_FORMAT=plain`), null-position, and
the `[PRP Auto]`-strip path) with the full triple (`not.toContain('Co-Authored-By')` +
`not.toMatch(/noreply@anthropic\.com/)` + `not.toContain('[PRP Auto]')`) — and ensure the code/docs carry
**no** §5.1 "style layer may add a trailer" carve-out (citing §9.10.2 instead).

**Deliverable**:
1. **`tests/unit/utils/git-commit.test.ts`** — (i) **VERIFY** the stray-`>` is gone (grep = 0; tests GREEN);
   (ii) **complete** the all-modes absence coverage: restructure the dedicated absence test
   (`NEVER adds a Co-Authored-By trailer…`, ~line 509-531) to a 4-mode cross-section (add the
   `PRP_COMMIT_FORMAT=plain` case) and cite **§9.10.2** in its title; (iii) **fix** the two stale test titles
   (`+ trailer` → drop `+ trailer`) at ~line 462 + ~line 478; (iv) **reword** the stale `Co-Authored-By trailer`
   comment at ~line 1400.
2. **`tests/integration/smart-commit.test.ts`** — **VERIFY ONLY** (it already asserts absence at lines
   387-418). No edit unless a gap is found during verification.
3. **`src/utils/git-commit.ts`** — **DOCS only**: in the `formatCommitMessage` `@remarks` (~line 196-230),
   append the **§9.10.2** citation and the "no style layer may add a `Co-Authored-By` trailer, ever" wording
   alongside the existing §5.1 citation. NO change to the function body (it already emits no trailer).
4. **Verify** (grep) that NO §5.1 carve-out wording + NO stray `>` survive anywhere in `src/` or the two tests.

**Success Definition**:
- `tests/unit/utils/git-commit.test.ts` is GREEN (existing + the restructured absence test), with a single
  dedicated test asserting the full ABSENCE triple across all 4 §9.10.2 modes.
- `tests/integration/smart-commit.test.ts` is GREEN (no edit; verifies its existing absence assertions).
- `src/utils/git-commit.ts` `formatCommitMessage` JSDoc cites §9.10.2 + states no style layer may add the
  trailer, ever.
- `grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/` = 0 hits.
- `grep -nE ">'[\),]" tests/unit/utils/git-commit.test.ts` = 0 hits (stray `>` confirmed gone).
- No test title contains `+ trailer`; no test comment asserts a `Co-Authored-By` trailer is present.
- `npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts` GREEN.
- `npm run typecheck && npm run lint && npm run format:check` clean (the JSDoc edit passes prettier).

---

## User Persona (if applicable)

**Target User**: The maintainer + the §9.10.2 acceptance gate. The guard test (P1.M3.T1.S1) walks `src/` for
forbidden identity literals; THIS item guarantees the BEHAVIORAL tests lock in the absence so a future
regression (a reintroduced `Co-Authored-By` literal) fails at test time in every mode.

**Use Case**: A contributor adds a "helpful" `Co-Authored-By` trailer back into `formatCommitMessage`; the
all-modes absence test + the structural guard (P1.M3.T1.S1) both fire.

**Pain Points Addressed**: The §9.10.2 incident (every work-item commit mis-attributed to Claude) regressed
once because the requirement had no test; the absence test in every mode is the behavioral half of the guard.

---

## Why

- **§9.10.2 mandates the behavioral test.** The structural guard (P1.M3.T1.S1) catches forbidden LITERALS in
  source; the behavioral test (THIS item) catches a trailer that sneaks in via a path the literal-scan can't
  see (e.g. a computed string). §9.10.2 acceptance: "formatCommitMessage unit/integration tests assert
  trailer/banner ABSENCE (not presence) in every mode." Both halves are required.
- **The contract premise is stale; verify, don't redo.** The stray-`>` blocker + the Co-Authored-By inversion
  are ALREADY done by the parallel P1.M2.T3.S2 rewire (live-verified: 0 stray `>`, 0 presence assertions).
  Re-rewiring would conflict with already-correct code. This item's value is (a) confirming that, and
  (b) closing the one real gap (the plain-mode absence case) + the §9.10.2 JSDoc citation + the stale titles.
- **The plain-mode gap is a real §9.10.2 hole.** The dedicated absence test covers null-position +
  task-prefix(env-unset) + [PRP Auto]-strip — but NOT `PRP_COMMIT_FORMAT=plain` (where a position IS supplied
  yet the format is plain). A trailer regressed in the plain branch would pass today's dedicated test. Closing
  it makes "every mode" literally true.
- **Stale titles/comments lie about behavior.** Tests titled `… + trailer` that assert `toBe('add utility')`
  (no trailer) mislead readers about what the code does. The comment @1400 ("plain subject + Co-Authored-By
  trailer") is a flat falsehood post-inversion. Fixing them rides with the §9.10.2 work.
- **Scope discipline.** This item edits 2 test files (1 substantially-but-surgically, 1 verify-only) + 1 JSDoc.
  It does NOT touch the `formatCommitMessage` body, the stagecoach mock wiring, the guard test (P1.M3.T1.S1),
  or any other src/ file.

---

## What

### User-visible behavior
None (tests + a JSDoc citation). The production behavior (`formatCommitMessage` emits no trailer) is unchanged
and already live.

### Technical requirements (exact edits — VERBATIM prescribed text + sites)

> ⚠️ **First, do no harm:** clauses (a)/(c)/(d) of the contract are ALREADY DONE in the live tree. The
> implementer MUST verify them (grep) and NOT re-rewire. Only the edits below are required.

#### VERIFY (no edit expected — confirmation greps; document the result in the commit)
- Stray `>`: `grep -nE ">'[\),]" tests/unit/utils/git-commit.test.ts` → expect **0**.
- No `noreply`/`Co-Authored` PRESENCE assertion: the only hits should be the dedicated ABSENCE test (~509-531,
  using `not.toContain`/`not.toMatch`) + the comment at ~1400 (reworded below). No `expect(...).toContain('Co-Authored-By')` or `toMatch(/noreply…/)` positive assertion.
- §5.1 carve-out: `grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/`
  → expect **0** (the phrase is gone; nothing to remove).
- smart-commit.test.ts absence: confirm tests at lines ~387-418 (`should layer the task-prefix and NOT emit
  [PRP Auto]…` + `should NOT add any Co-Authored-By trailer…`) assert absence. **No edit unless a mode/gap
  is found** — if so, mirror the git-commit.test.ts fix.

#### EDIT 1 — `tests/unit/utils/git-commit.test.ts` — complete all-modes absence coverage (Gap 1)

**Site — the dedicated absence test** (`describe('formatCommitMessage')`, ~line 509-531), currently:
```ts
    it('NEVER adds a Co-Authored-By trailer in ANY output (identity-transparent, §5.1)', () => {
      // EXECUTE a representative cross-section of both modes + the strip path.
      const results = [
        formatCommitMessage('plain msg'),
        formatCommitMessage('prefixed msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        }),
        formatCommitMessage('[PRP Auto] stripped msg', null),
      ];

      // VERIFY — NO trailer/banner/machine author in any output (§5.1
      // commit-identity transparency). The prior hardcoded
      // `Co-Authored-By: Claude <noreply@anthropic.com` literal was a spec
      // violation (it mis-attributed pi/z.ai work to Claude) and is removed.
      for (const result of results) {
        expect(result).not.toContain('Co-Authored-By');
        expect(result).not.toMatch(/noreply@anthropic\.com/);
        // And NEVER the banner
        expect(result).not.toContain('[PRP Auto]');
      }
    });
```
**Replace with** a 4-mode cross-section (adds the explicit `PRP_COMMIT_FORMAT=plain` case), cite **§9.10.2** in
the title, keep the full triple. The describe block's `beforeEach(delete PRP_COMMIT_FORMAT)` + `afterEach(unstubAllEnvs)` (~408/412) make a per-case `vi.stubEnv` safe:
```ts
    it('NEVER adds a Co-Authored-By trailer / banner in ANY mode (§9.10.2 identity-transparency)', () => {
      // EXECUTE ALL FOUR §9.10.2 modes — task-prefix, plain, null-position
      // (non-backlog), and the [PRP Auto]-strip path — asserting the ABSENCE
      // triple in each. The describe-level beforeEach(delete) + afterEach(unstub)
      // make the vi.stubEnv safe. The prior hardcoded
      // `Co-Authored-By: Claude <noreply@anthropic.com` literal was a spec
      // violation (it mis-attributed pi/z.ai work to Claude on every commit) and
      // is removed; no style layer may add it back (§9.10.2).
      const results: string[] = [
        // (1) task-prefix mode — env UNSET (default); position supplied.
        formatCommitMessage('task-prefix msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        }),
      ];
      // (2) plain mode — PRP_COMMIT_FORMAT=plain; position supplied but ignored.
      vi.stubEnv('PRP_COMMIT_FORMAT', 'plain');
      results.push(
        formatCommitMessage('plain-mode msg', {
          phase: 1,
          milestone: 2,
          task: 1,
          subtask: 1,
        })
      );
      vi.unstubAllEnvs();
      // (3) null-position mode (non-backlog) → plain.
      results.push(formatCommitMessage('non-backlog msg'));
      // (4) [PRP Auto]-strip path — banner input, null position.
      results.push(formatCommitMessage('[PRP Auto] stripped msg', null));

      // VERIFY — NO trailer / banner / machine author in ANY output, every mode.
      expect(results).toHaveLength(4);
      for (const result of results) {
        expect(result).not.toContain('Co-Authored-By');
        expect(result).not.toMatch(/noreply@anthropic\.com/);
        expect(result).not.toContain('[PRP Auto]');
      }
    });
```
**Note:** the prior 3-case array is preserved in spirit (renamed: `'plain msg'`→`'non-backlog msg'`,
`'prefixed msg'`→`'task-prefix msg'`) PLUS the new plain-mode case. The for-loop + `toHaveLength(4)` guard
against a future editor dropping a case silently. (If the `results: string[]` explicit-typed-array +
`push` style fights the file's convention, an equivalent 4-literal-array built after stubbing plain then
unstubbing is acceptable — the requirement is: all 4 modes computed + the triple asserted on each.)

#### EDIT 2 — `tests/unit/utils/git-commit.test.ts` — fix stale `+ trailer` titles + comment

- **Title @~462:** `'position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED) + trailer'` → drop
  `+ trailer`: `'position + PRP_COMMIT_FORMAT=plain → plain (position IGNORED, NO trailer)'`.
- **Title @~478:** `'position + PRP_COMMIT_FORMAT=task-prefix (explicit default honored) → prefix + trailer'`
  → `'position + PRP_COMMIT_FORMAT=task-prefix (explicit default honored) → prefix, NO trailer'`.
- **Comment @~1400:** `// wrapped via formatCommitMessage (plain subject + Co-Authored-By` → reword to
  `// wrapped via formatCommitMessage (plain subject, NO Co-Authored-By trailer, no` (so the comment matches
  the no-trailer reality). Read the surrounding lines to keep the sentence coherent.
- (Optionally extend the `not.toContain('[PRP Auto]')` assertions at @462/@478 to also assert
  `not.toContain('Co-Authored-By')` — but EDIT 1 already covers all modes centrally, so this is optional.
  Preferred: leave @462/@478 as format-only assertions; EDIT 1 owns the absence triple.)

#### EDIT 3 — `src/utils/git-commit.ts` — `formatCommitMessage` JSDoc cites §9.10.2 (DOCS, Gap 2)

**Site — the `@remarks` bullet** (~line 211-217) that currently reads:
```
 * - NEVER appends a `Co-Authored-By` trailer, a `Generated-by` footer, or any
 *   machine/branded authorship. PRD §5.1 "Commit-identity transparency" forbids
 *   them; the prior unconditional `Co-Authored-By: Claude <noreply@anthropic.com>`
 *   literal was a spec violation (it mis-attributed pi/z.ai work to Claude on
 *   every commit) and is removed.
```
**Replace** the last sentence so it cites §9.10.2 + states the carve-out is closed:
```
 * - NEVER appends a `Co-Authored-By` trailer, a `Generated-by` footer, or any
 *   machine/branded authorship. PRD §5.1 "Commit-identity transparency" + §9.10.2
 *   "Commit-Identity Structural Guard" forbid them; the prior unconditional
 *   `Co-Authored-By: Claude <noreply@anthropic.com>` literal was a spec violation
 *   (it mis-attributed pi/z.ai work to Claude on every commit) and is removed, and
 *   no style layer may add a `Co-Authored-By` trailer, ever (§9.10.2 closes §5.1's
 *   "unless an explicit style layer below adds one" carve-out).
```
(The function body at 231-246 is UNCHANGED — this is a JSDoc-only edit. prettier `format:check` will reflow
the bullet; run `npm run fix`.)

### Success Criteria
- [ ] `grep -nE ">'[\),]" tests/unit/utils/git-commit.test.ts` = 0 (stray `>` confirmed gone — verify).
- [ ] `grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/` = 0 (carve-out gone — verify).
- [ ] `formatCommitMessage` dedicated absence test asserts the full triple across all 4 modes (task-prefix,
      plain, null-position, [PRP Auto]-strip); title cites §9.10.2.
- [ ] No test title contains `+ trailer`; the comment @~1400 no longer claims a `Co-Authored-By` trailer.
- [ ] `formatCommitMessage` JSDoc cites §9.10.2 + states no style layer may add the trailer, ever.
- [ ] `smart-commit.test.ts` verified (absence assertions present; no edit).
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts` GREEN.
- [ ] `npm run typecheck && npm run lint && npm run format:check` clean.

---

## All Needed Context

### Context Completeness Check
_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the stale-contract
reconciliation is explicit (which clauses are done vs the real gaps), the verbatim current text + replacement
for each edit site is quoted, the live-verified facts (2621-line file, 0 stray `>`, 0 carve-out, 0 presence
assertions) are stated with grep commands, and the env-stub harness (already present in the describe block)
is confirmed. See `research/01-reconciliation-and-gaps.md` for the per-clause evidence.

### Documentation & References
```yaml
# MUST READ — the authoritative survey (cited in the contract; note §1 is STALE post-rewire)
- docfile: plan/015_459c7d9be558/architecture/commit-tests-survey.md
  section: "1. tests/unit/utils/git-commit.test.ts" (the stray-`>` blocker claim — STALE) + "3. tests/integration/smart-commit.test.ts" (already inverted — current)
  why: Maps the test-suite state; §1's stray-`>` claim is superseded by the P1.M2.T3.S2 rewire (live-verified gone). §3 is current.
  critical: Do NOT act on §1's "strip the stray >" instruction — it's done. The real gap is the §9.10.2 all-modes plain-mode case + the JSDoc citation.

# MUST READ — PRD §9.10.2 (the contract this enforces)
- file: PRD.md
  section: "9.10.2 Commit-Identity Structural Guard" (Requirement — behavioral test: absence across task-prefix/plain/null-position + [PRP Auto]-strip; §5.1 carve-out removed)
  why: "formatCommitMessage is asserted — across task-prefix, plain, and non-backlog (null-position) modes, plus the [PRP Auto]-strip path — to contain no Co-Authored-By, no noreply@anthropic.com, and no [PRP Auto] banner." + "§5.1's 'unless an explicit style layer below adds one' carve-out is removed."
  critical: ALL FOUR modes × the full triple. The plain mode is the gap.

# THE INPUT CONTRACT (COMPLETED — explains why the stray-`>` is already gone)
- docfile: plan/015_459c7d9be558/P1M2T3S2/PRP.md
  why: The rewire that rewrote git-commit.test.ts (2233→2621), moved the mock to the stagecoach binary boundary, AND cleaned the stray `>` + inverted Co-Authored-By. Its PRP explicitly states "the stray-`>` bug is ALREADY RESOLVED; verify, do NOT re-rewire."
  critical: My item INHERITS the post-rewire tree. Re-rewiring the stagecoach mock or re-stripping `>` would conflict with already-correct code.

# THE PARALLEL SIBLING (disjoint — what it owns vs what I own)
- docfile: plan/015_459c7d9be558/P1M3T1S1/PRP.md
  why: P1.M3.T1.S1 creates tests/unit/guards/commit-identity-guard.test.ts (structural: walks src/ for forbidden identity literals). MY item = git-commit.test.ts behavioral + formatCommitMessage JSDoc. File-disjoint.
  critical: My JSDoc edit (EDIT 3) is a comment citation → the guard's comment-skip ignores it; no false trip. Do NOT touch the guard file.

# THE FILE TO EDIT (tests) — verify + the all-modes completion + stale-title/comment cleanup
- file: tests/unit/utils/git-commit.test.ts
  why: EDIT 1 (restructure the dedicated absence test @509-531 to 4 modes + §9.10.2 title) + EDIT 2 (drop `+ trailer` from titles @462/@478; reword comment @1400). The describe block's beforeEach(delete PRP_COMMIT_FORMAT) + afterEach(unstubAllEnvs) @408/412 make vi.stubEnv safe.
  pattern_abstest: "build a `results: string[]` across the 4 modes (stub plain for case 2, unstub before cases 3-4), then a for-loop asserting the triple on each + toHaveLength(4)."
  critical: Do NOT re-rewire the stagecoach-resolver mock (@31-72) or re-strip a stray `>` — both are done. typecheck EXCLUDES tests → validate via `npx vitest run`.

# THE FILE TO VERIFY (tests) — already inverted
- file: tests/integration/smart-commit.test.ts
  why: VERIFY ONLY. Lines ~387-418 already assert `not.toContain('Co-Authored-By')` / `not.toMatch(/\n\nCo-Authored-By:/)`. The mock returns `msg` verbatim (no trailer). Edit ONLY if verification finds a gap.
  critical: Do not edit preemptively. If a mode is uncovered, mirror EDIT 1's 4-mode approach.

# THE FILE TO EDIT (src) — DOCS only (JSDoc citation)
- file: src/utils/git-commit.ts
  section: "formatCommitMessage @remarks (~196-230)"
  why: EDIT 3 — append §9.10.2 to the @remarks bullet + state no style layer may add the trailer. The function body (231-246) is UNCHANGED (it already emits no trailer).
  critical: JSDoc-only. The sibling P1.M3.T1S1 guard walks NON-COMMENT lines for forbidden literals; my edit is INSIDE a `* ` JSDoc comment → skipped. §9.10.2 / "style layer" are not on the guard's forbidden-token list. No false trip.

# THE DONE BEHAVIOR (read-only — my tests assert it; I do NOT change it)
- file: src/utils/git-commit.ts
  section: "formatCommitMessage (231-246)"
  why: READ-ONLY. Strips [PRP Auto] (defense-in-depth), layers `<prefix>: ` when position+task-prefix, returns bare/prefixed subject with NO trailer / NO machine author (identity-transparent §5.1+§9.10.2).
  critical: Do NOT modify the function body. Only its JSDoc (EDIT 3).

# OUT OF SCOPE (hard boundary — DO NOT touch)
- src/utils/git-commit.ts formatCommitMessage body          # DONE; my tests assert it
- tests/unit/guards/commit-identity-guard.test.ts            # P1.M3.T1S1 (parallel); disjoint
- the stagecoach-resolver mock wiring (@31-72)               # P1.M2.T3.S2 (DONE)
- src/tools/git-mcp.ts (the "commit-style layer" @555/559)   # a real FEATURE (PRP_COMMIT_STYLE), NOT the §5.1 carve-out — leave it
- any other src/ or test file
```

### Current Codebase tree (relevant slice)
```bash
tests/unit/utils/git-commit.test.ts     # EDIT 1 (4-mode absence test @509) + EDIT 2 (titles @462/@478 + comment @1400)
tests/integration/smart-commit.test.ts  # VERIFY ONLY (absence @387-418)
src/utils/git-commit.ts                 # EDIT 3 (formatCommitMessage @remarks JSDoc — §9.10.2 citation)
tests/unit/guards/commit-identity-guard.test.ts  # READ-ONLY (P1.M3.T1S1; disjoint)
```

### Desired Codebase tree with files to be added/edited
```bash
tests/unit/utils/git-commit.test.ts     # MODIFIED (1 restructured absence test + 2 title fixes + 1 comment reword)
src/utils/git-commit.ts                 # MODIFIED (formatCommitMessage @remarks: +§9.10.2 citation; body UNCHANGED)
# (smart-commit.test.ts: verify-only, expected NO change; no new files; no new deps)
```

### Known Gotchas of our codebase & Library Quirks
```ts
// CRITICAL — The contract's stray-`>` premise is STALE. The P1.M2.T3.S2 rewire already resolved it
//   (live: grep ">'[\),]" = 0; file is 2621 lines). Do NOT re-strip a `>` that isn't there and do NOT
//   re-rewire the stagecoach mock. VERIFY (grep) and move on to the real gaps.

// CRITICAL — typecheck EXCLUDES tests (tsconfig.build.json). Validate test edits via
//   `npx vitest run tests/unit/utils/git-commit.test.ts` (NOT `npm run typecheck` for the test file).

// CRITICAL — The §5.1 carve-out phrase is ALREADY GONE from src/ (grep = 0). There is nothing to remove.
//   The DOCS work is ADDITIVE: cite §9.10.2 in the formatCommitMessage @remarks (it currently cites only §5.1).

// CRITICAL — EDIT 3 is INSIDE a JSDoc comment (a `* `-prefixed block). The sibling P1.M3.T1S1 guard skips
//   comment lines, AND §9.10.2 / "style layer" are not on its forbidden-token list → no false trip. Do not
//   add a forbidden literal (Co-Authored-By / noreply@anthropic.com / GIT_AUTHOR_*) as a NON-comment string.

// GOTCHA — The formatCommitMessage describe block's beforeEach(delete PRP_COMMIT_FORMAT) + afterEach(unstubAllEnvs)
//   (@408/412) are what make the vi.stubEnv('plain') in EDIT 1 safe. Do NOT add a second nested hook. The
//   stub persists until the afterEach unstub; computing the plain case THEN vi.unstubAllEnvs() before the
//   null-position/strip cases keeps the env default for cases 1/3/4.

// GOTCHA — vitest `toHaveLength` exists; `results.toHaveLength(4)` guards against a future editor silently
//   dropping a mode from the cross-section. Keep it (the §9.10.2 "every mode" requirement is the point).

// GOTCHA — prettier `format:check` is enforced (incl. the .ts JSDoc). The EDIT 1 restructure + the EDIT 3
//   bullet may reflow; run `npm run fix` (lint:fix + prettier --write) BEFORE format:check. Let the formatter
//   own the multi-line array + bullet alignment.

// GOTCHA — src/tools/git-mcp.ts:555/559 mentions "commit-style layer" — that is the REAL PRP_COMMIT_STYLE
//   feature (§5.1 style layer), NOT the §5.1 Co-Authored-By carve-out. Do NOT touch it. The carve-out is the
//   "unless an explicit style layer below adds one [trailer]" wording, which is already gone.

// CRITICAL — Do NOT touch the formatCommitMessage BODY (231-246), the guard test, smart-commit.test.ts
//   (verify-only), the stagecoach mock, or any src/ file other than the formatCommitMessage @remarks.
```

---

## Implementation Blueprint

### Data models and structure
None (tests + a JSDoc citation). No types, schemas, or production code.

### Implementation Tasks (ordered; verify-then-edit)
```yaml
Task 0: VERIFY the done clauses (no edit — confirm the stale-contract reconciliation)
  - RUN: grep -nE ">'[\),]" tests/unit/utils/git-commit.test.ts                         # expect 0 (stray > gone)
  - RUN: grep -nE "noreply|Co-Authored" tests/unit/utils/git-commit.test.ts             # expect ONLY the dedicated absence test (@~509-531, not.toContain/not.toMatch) + comment @~1400
  - RUN: grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/  # expect 0 (carve-out gone)
  - RUN: grep -nE "Co-Authored|noreply|\[PRP Auto\]|not.toContain" tests/integration/smart-commit.test.ts  # expect the absence tests @~387-418
  - RECORD: these greps in the commit message (proves the contract's (a)/(c)/(d) are done).
  - If ANY grep returns UNEXPECTED (e.g. a stray `>` survives, a presence assertion remains, the carve-out
    phrase is found) → handle it (strip the `>` / invert the assertion / remove the carve-out) per the
    contract's original wording; otherwise proceed to Task 1.

Task 1: EDIT tests/unit/utils/git-commit.test.ts — restructure the dedicated absence test (Gap 1, §9.10.2)
  - REPLACE the `it('NEVER adds a Co-Authored-By trailer in ANY output (identity-transparent, §5.1)', …)`
    block (~509-531) with the 4-mode cross-section version in "Technical requirements EDIT 1". Title cites §9.10.2;
    cases = task-prefix (env unset) / plain (vi.stubEnv PRP_COMMIT_FORMAT=plain, then unstub) / null-position /
    [PRP Auto]-strip; for-loop asserts the triple on each + results.toHaveLength(4).
  - DO NOT: change the describe block hooks; add a forbidden literal as a non-comment string; touch the
    stagecoach mock; modify any other test.
  - VERIFY: npx vitest run tests/unit/utils/git-commit.test.ts → the formatCommitMessage block GREEN (incl. the
    restructured test + the existing 478 plain/task-prefix-env tests).

Task 2: EDIT tests/unit/utils/git-commit.test.ts — fix stale `+ trailer` titles + comment
  - DROP `+ trailer` from the title at ~462 → '…→ plain (position IGNORED, NO trailer)'.
  - DROP `+ trailer` from the title at ~478 → '…→ prefix, NO trailer'.
  - REWORD the comment at ~1400 ('plain subject + Co-Authored-By trailer' → 'plain subject, NO Co-Authored-By trailer').
  - VERIFY: grep -nE "\+ trailer" tests/unit/utils/git-commit.test.ts → 0; grep "Co-Authored-By trailer" → only
    legitimate absence-test references remain.

Task 3: EDIT src/utils/git-commit.ts — formatCommitMessage @remarks cites §9.10.2 (DOCS, Gap 2)
  - REPLACE the @remarks bullet (~211-217) per "Technical requirements EDIT 3" (append §9.10.2; state no style
    layer may add the trailer, ever; the function body 231-246 is UNCHANGED).
  - VERIFY: npm run typecheck (clean — comment-only) + grep -n "§9.10.2\|9.10.2" src/utils/git-commit.ts → ≥1 hit.

Task 4: VERIFY smart-commit.test.ts (no edit expected)
  - READ tests/integration/smart-commit.test.ts @~387-418 — confirm both tests assert absence
    (not.toContain('Co-Authored-By') / not.toMatch(/\n\nCo-Authored-By:/)).
  - IF a mode is uncovered → mirror Task 1's 4-mode approach; ELSE no edit.

Task 5: FORMAT + VERIFY
  - RUN: npm run fix → npm run typecheck → npm run lint → npm run format:check.
  - RUN: npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts   # GREEN.
  - RUN: npx vitest run tests/unit/guards/commit-identity-guard.test.ts  (if present) → GREEN (my JSDoc edit
    must not trip it; it's a comment citation).
  - EXPECTED: typecheck/lint/format clean; the 2 test files GREEN; the guard (if present) GREEN.
    If the guard trips → EDIT 3 introduced a forbidden literal as a NON-comment string (re-check: the §9.10.2
    citation + "style layer" wording must stay inside the `* ` JSDoc block). If formatCommitMessage block fails
    → the 4-mode array's env stub bled (confirm vi.unstubAllEnvs() runs before cases 3-4; confirm the describe
    beforeEach deletes PRP_COMMIT_FORMAT).
```

### Implementation Patterns & Key Details
```ts
// ---- EDIT 1: the 4-mode absence cross-section (Task 1) ----
const results: string[] = [ /* (1) task-prefix, env unset */ formatCommitMessage('task-prefix msg', {…}) ];
vi.stubEnv('PRP_COMMIT_FORMAT', 'plain');                     // (2) plain mode
results.push(formatCommitMessage('plain-mode msg', {…}));
vi.unstubAllEnvs();                                           // reset before cases 3-4 (env default)
results.push(formatCommitMessage('non-backlog msg'));         // (3) null-position
results.push(formatCommitMessage('[PRP Auto] stripped msg', null)); // (4) strip path
expect(results).toHaveLength(4);
for (const result of results) {
  expect(result).not.toContain('Co-Authored-By');
  expect(result).not.toMatch(/noreply@anthropic\.com/);
  expect(result).not.toContain('[PRP Auto]');
}

// ---- EDIT 3: the @remarks bullet (Task 3) ----
//  * - NEVER appends a `Co-Authored-By` trailer … PRD §5.1 "Commit-identity transparency" + §9.10.2
//  *   "Commit-Identity Structural Guard" forbid them; … removed, and no style layer may add a
//  *   `Co-Authored-By` trailer, ever (§9.10.2 closes §5.1's "unless an explicit style layer below
//  *   adds one" carve-out).
```

### Integration Points
```yaml
GIT-COMMIT.TEST.TS:
  - describe('formatCommitMessage'): restructure the dedicated absence test (@509) to 4 modes + §9.10.2 title.
  - titles @462/@478: drop `+ trailer`; comment @1400: reword.
  - PRESERVE: the describe hooks (@408/412), the stagecoach mock (@31-72), all other describe blocks.

SMART-COMMIT.TEST.TS:
  - VERIFY ONLY (absence @387-418). Edit only if a mode gap is found.

GIT-COMMIT.TS (src):
  - formatCommitMessage @remarks (@211-217): +§9.10.2 citation + "no style layer may add the trailer, ever".
  - PRESERVE: the function body (231-246) — DONE; emits no trailer.

GUARD (P1.M3.T1S1, disjoint):
  - my JSDoc edit is inside a comment → the guard's comment-skip ignores it; §9.10.2/"style layer" aren't
    forbidden tokens. No false trip. Do NOT touch the guard file.

OUT OF SCOPE (hard boundary):
  - formatCommitMessage body, the guard test, smart-commit.test.ts (verify-only), the stagecoach mock wiring,
    src/tools/git-mcp.ts "commit-style layer" (a real feature), any other src/ or test file.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)
```bash
npm run fix            # lint:fix + prettier --write (the restructured array + the JSDoc bullet reflow)
npm run typecheck      # clean (the JSDoc edit is comment-only; test edits aren't typechecked — see Level 2)
npm run lint           # clean
npm run format:check   # clean (incl. the .ts JSDoc)
# Expected: all clean. Likely failure: a prettier reflow of EDIT 1's array or EDIT 3's bullet → `npm run fix`.
```

### Level 2: Unit Tests (Component Validation)
```bash
# The edited file (restructured absence test + title/comment fixes) + the verify-only file:
npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts
# The guard (disjoint) — must stay GREEN (my JSDoc edit must not trip it):
npx vitest run tests/unit/guards/commit-identity-guard.test.ts   # if present
# Expected: all green. If the formatCommitMessage block fails → the 4-mode array's env stub bled (confirm
#   vi.unstubAllEnvs() before cases 3-4 + the describe beforeEach deletes PRP_COMMIT_FORMAT). If the guard
#   trips → EDIT 3 leaked a forbidden literal as a non-comment string (keep §9.10.2/"style layer" inside the
#   `* ` JSDoc block).
```

### Level 3: Integration / Regression (System Validation)
```bash
# Confirm the contract reconciliation (done clauses stay done):
grep -nE ">'[\),]" tests/unit/utils/git-commit.test.ts                          # 0 (stray > gone)
grep -rnEi "unless an explicit style layer|style layer.*adds one|may add a.*trailer" src/  # 0 (carve-out gone)
grep -nE "\+ trailer" tests/unit/utils/git-commit.test.ts                       # 0 (titles fixed)
grep -nE "9\.10\.2" src/utils/git-commit.ts tests/unit/utils/git-commit.test.ts # ≥2 (JSDoc + the absence-test title)
# Confirm the absence test covers all 4 modes (the §9.10.2 requirement):
grep -nE "task-prefix msg|plain-mode msg|non-backlog msg|stripped msg" tests/unit/utils/git-commit.test.ts  # 4 labels
# Confirm no PRESENCE assertion survived:
grep -nE "toContain\('Co-Authored-By'\)|toMatch\(/noreply" tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts  # 0 (only not.toContain/not.toMatch)
```

### Level 4: Creative & Domain-Specific Validation
```bash
# No MCP/DB/HTTP. Domain checks (record in commit message):
#   1. The §9.10.2 behavioral test asserts ABSENCE in ALL FOUR modes (task-prefix / plain / null-position /
#      [PRP Auto]-strip) × the full triple (Co-Authored-By / noreply@anthropic.com / [PRP Auto]).
#   2. The contract's (a) stray-`>` and (c)/(d) inversion/carve-out are confirmed DONE by the parallel
#      rewire — NOT redone (avoid conflicting with already-correct code).
#   3. The formatCommitMessage JSDoc cites §9.10.2 + states no style layer may add the trailer, ever.
#   4. The stale `+ trailer` titles + the @1400 comment no longer claim a trailer that doesn't exist.
#   5. The sibling guard (P1.M3.T1S1) stays GREEN — my JSDoc edit is comment-only + non-forbidden tokens.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npm run lint` clean.
- [ ] `npm run format:check` clean.
- [ ] `npx vitest run tests/unit/utils/git-commit.test.ts tests/integration/smart-commit.test.ts` GREEN.
- [ ] `npx vitest run tests/unit/guards/commit-identity-guard.test.ts` GREEN (if present; no false trip).

### Feature Validation
- [ ] `formatCommitMessage` absence test asserts the full triple across all 4 §9.10.2 modes; title cites §9.10.2.
- [ ] No `+ trailer` test title; the @1400 comment no longer claims a Co-Authored-By trailer.
- [ ] `formatCommitMessage` JSDoc cites §9.10.2 + "no style layer may add the trailer, ever".
- [ ] `smart-commit.test.ts` verified (absence @387-418; no edit unless a gap was found).
- [ ] Stray `>` confirmed gone (grep = 0); §5.1 carve-out confirmed gone from src/ (grep = 0).

### Code Quality Validation
- [ ] EDIT 1 reuses the describe block's existing env harness (no duplicate hooks); `toHaveLength(4)` guards the cross-section.
- [ ] EDIT 3 is JSDoc-only (the formatCommitMessage body is UNCHANGED).
- [ ] Only the 2 named files edited (git-commit.test.ts substantially-but-surgically; git-commit.ts JSDoc); smart-commit.test.ts verify-only.
- [ ] No forbidden identity literal added as a NON-comment string (the guard stays GREEN).

### Documentation & Deployment
- [ ] formatCommitMessage `@remarks` documents the §9.10.2 enforcement + the closed carve-out.
- [ ] Commit message records: the stale-contract reconciliation (a)/(c)/(d) done by the parallel rewire —
      verified, not redone; the real gaps closed (the 4-mode plain case; the §9.10.2 JSDoc citation; the stale
      titles/comment); the §9.10.2 "every mode × full triple" behavioral test; disjointness from the guard.

---

## Anti-Patterns to Avoid

- ❌ Don't re-strip a stray `>` that isn't there, and don't re-rewire the stagecoach mock. The contract's (a)
      premise is STALE — the P1.M2.T3.S2 rewire already resolved it (live: `grep ">'[\),]"` = 0; file is 2621
      lines). VERIFY (grep) and move on. Re-doing it risks conflicting with already-correct code.
- ❌ Don't search-and-destroy the §5.1 "style layer" phrase in `src/tools/git-mcp.ts:555/559`. That "commit-style
      layer" is the REAL `PRP_COMMIT_STYLE` feature (§5.1 style layer), NOT the forbidden Co-Authored-By
      carve-out. The carve-out ("unless an explicit style layer below adds one [trailer]") is already gone
      (grep = 0). Leave the feature wording alone.
- ❌ Don't drop a mode from the absence cross-section. §9.10.2 requires ALL FOUR (task-prefix / plain /
      null-position / [PRP Auto]-strip). The `toHaveLength(4)` guard + the for-loop are the point — a future
      editor silently dropping a case must fail. The plain mode (PRP_COMMIT_FORMAT=plain) is the gap this item closes.
- ❌ Don't edit the `formatCommitMessage` body (231-246). It is DONE — it emits no trailer. This item only
      (a) inverts/extends the TESTS that assert that behavior and (b) adds a §9.10.2 citation to its JSDoc.
- ❌ Don't let EDIT 3 (the JSDoc) leak a forbidden literal as a NON-comment string. The sibling P1.M3.T1S1 guard
      walks non-comment lines for `Co-Authored-By` / `noreply@anthropic.com` / `GIT_AUTHOR_*` / git-config
      `user.name`/`user.email`. Keep the §9.10.2 citation + "style layer" wording INSIDE the `* ` JSDoc block
      (comment lines are skipped; §9.10.2/"style layer" aren't forbidden tokens anyway).
- ❌ Don't add a duplicate `beforeEach`/`afterEach` in the formatCommitMessage describe block for EDIT 1's env
      stub. The block already has them (@408 delete PRP_COMMIT_FORMAT / @412 unstubAllEnvs). Just `vi.stubEnv`
      inside the test body + `vi.unstubAllEnvs()` before the env-default cases.
- ❌ Don't forget `npm run fix` before `npm run format:check` — the restructured array + the JSDoc bullet reflow.
- ❌ Don't use `npm run typecheck` to validate the test edits (typecheck excludes tests). Use
      `npx vitest run tests/unit/utils/git-commit.test.ts`.
- ❌ Don't touch the guard test (P1.M3.T1S1), smart-commit.test.ts (verify-only), the stagecoach mock, or any
      src/ file other than the formatCommitMessage `@remarks`.
- ❌ Don't leave stale lies. The `+ trailer` titles (@462/@478) + the @1400 comment assert/describe a trailer
      the code no longer emits — fix them (the assertions already omit the trailer; the titles/comments must
      match).

---

## Confidence Score

**9/10** — One-pass implementation success likelihood.

Rationale: This is a small, surgical, test+JSDoc slice. The critical risk — acting on a STALE contract and
re-doing already-completed work (the stray-`>` strip, the Co-Authored-By inversion, the carve-out removal) — is
explicitly pre-empted: the reconciliation table (done vs real-gap) + the Task-0 verification greps + the
"don't re-rewire" anti-patterns all steer the implementer to VERIFY the live tree first. The two real gaps are
fully specified verbatim: the 4-mode absence-test restructure (with the env-harness already confirmed present
in the describe block) + the §9.10.2 JSDoc citation (comment-only, no body change). The stale-title/comment
cleanup is mechanical. The live-verified facts (2621-line file, 0 stray `>`, 0 carve-out, 0 presence
assertions, the absence test @509-531, smart-commit @387-418) are all quoted with grep commands. The
disjointness from the parallel guard (P1.M3.T1S1) is proven (comment-skip + non-forbidden tokens). Residual
risks are minor + mitigated: (a) a prettier reflow (auto-fixed via `npm run fix`); (b) an env-stub bleed in
the 4-mode array (caught at Level 2; fix = `vi.unstubAllEnvs()` before the env-default cases); (c) the guard
tripping on EDIT 3 (impossible — it's a comment citation + non-forbidden tokens). The deterministic grep gates
+ the 2-file vitest gate confirm correctness in one pass.